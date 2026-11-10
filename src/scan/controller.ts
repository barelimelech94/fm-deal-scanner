import type { HoverCollector, HoverEvent } from '../appraisal/hovers';
import type { HoverScanner } from '../appraisal/hoverScan';
import { CaptureFailed } from '../capture/screen';
import type { Engine } from '../engine';
import { esc } from '../lib/format';
import type { Region, ScanMode } from '../lib/types';
import type { ShopSession } from '../shop/session';
import type { Ocr, Scanner } from './scanner';

/** A frame to read, and what to call once it has been copied. */
export interface FrameGrab<F> { frame: F; done(): void }

/** The screen share, as the controller uses it (ScreenCapture in the browser, a fake in tests). */
export interface CaptureSource<F> {
  readonly active: boolean;
  start(onEnded: () => void): Promise<void>;
  stop(): void;
  grab(): Promise<FrameGrab<F> | null>;
  /** waits a few seconds for a first frame */
  grabSoon(): Promise<FrameGrab<F> | null>;
  sharingWholeScreen(): boolean;
}

/** Something that calls the controller's tick every so often. */
export interface Repeater { start(ms: number): void; stop(): void }

/** The text reader: it loads once, then reads. */
export interface TextReader<I> extends Ocr<I> { readonly ready: boolean; load(): Promise<unknown> }

export interface ControllerDeps<F, I> {
  engine: Engine;
  capture: CaptureSource<F>;
  /** makes the repeater that calls `tick` */
  repeat(tick: () => void): Repeater;
  reader: TextReader<I>;
  session: ShopSession;
  shop: Scanner<F, I>;
  collector: HoverCollector;
  hovers: HoverScanner<F, I>;
  /** the shop area marked by hand, if any */
  shopRegion(): Region | null;
  /** where hovers count: near the marked item area, or anywhere (null) */
  itemsArea(): Region | null;
}

/**
 * What changed: the open shop or the deals (`shop`), your items or whether they are being scanned (`hover`,
 * with what the last hover read did, or null), the status line (`status`), or a check of the screen ended (`checked`).
 */
export type ScanChange = { kind: 'shop' } | { kind: 'hover'; event: HoverEvent | null } | { kind: 'status' } | { kind: 'checked' };

/**
 * What a check reads now. Deals: the shop list, its area found by itself, still looked for, marked by hand, or to
 * be marked and not yet. Inventory: your items' tooltips anywhere, or beside the marked area, or nothing while paused.
 */
export type ReadTarget = 'shop-found' | 'shop-looking' | 'shop-marked' | 'shop-unset' | 'items' | 'items-marked' | 'paused';

export type StatusState = 'idle' | 'busy' | 'watching' | 'shop';
/** The status line: a state for its dot, and the words, as HTML. */
export interface ScanStatus { state: StatusState; html: string }

const IDLE = '<b>Not capturing.</b> Press Start capture and pick the MapleStory window.';
const PREVIEW = 'Screen capture is blocked because this page is open inside a preview or frame. Open it in its own Chrome tab.';
const MACPERM = 'macOS refused the capture. In System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, turn Chrome off and on again, then <b>quit Chrome with ⌘Q</b> and reopen it. Chrome only picks up that setting after a full restart.';
const READER_FAILED = 'The text reader failed to load. Check your internet connection and reload this page.';
const CANT_READ = "<b>Can't read the screen.</b> Stop and start capture again, or reload the page.";
/** Checks in a row whose frame could not be grabbed or made ready to read, before the status line says so. */
const FAILS_TO_TELL = 3;

/** Why a capture could not start, in words the person can act on. */
function captureErrorText(e: CaptureFailed): string {
  const text = e.kind === 'unsupported' ? PREVIEW : e.kind === 'blocked-by-system' ? MACPERM
    : e.kind === 'cancelled' ? `Capture was cancelled. Press <b>Start capture</b>, choose the <b>Window</b> tab, select MapleStory and press <b>Share</b>. If no picker appeared at all: ${MACPERM}`
    : 'Capture failed.';
  return `${text}${e.detail ? ` <span class="dim">(${esc(e.detail)})</span>` : ''}`;
}

/**
 * The scanning, without the page: the capture, the ticker, the text reader, both scanners and the mode.
 * One thing at a time: in `deals` mode it looks for a shop and reads its list and the tooltips over it, and
 * never feeds your items; in `inventory` mode it reads hovered tooltips into your items while scanning is on,
 * and never looks for a shop. Each tooltip is read once, by the mode's own reader. Listeners hear what changed.
 */
export class ScanController<F, I> {
  /** checks of the screen done, with a frame to look at */
  scans = 0;
  /** why capture or the reader failed, as HTML; null when nothing did */
  error: string | null = null;
  /** the check under way, if one is, and a forced one asked for while it runs */
  private running: Promise<void> | null = null;
  private next: Promise<void> | null = null;
  /**
   * Rises whenever what a check reads for is reset: the mode changed, scanning was paused, capture stopped, a new
   * screenshot was picked. A check that ends in another generation than it began in is dropped.
   */
  private generation = 0;
  /** checks in a row whose frame could not be grabbed or made ready to read */
  private failures = 0;
  private loading = false;
  /** a screenshot picked with "Test with a screenshot", read instead of the share */
  private still: F | null = null;
  private readonly ticker: Repeater;
  private readonly listeners: ((c: ScanChange) => void)[] = [];
  private shown = '';

  constructor(private readonly d: ControllerDeps<F, I>) {
    this.ticker = d.repeat(() => void this.tick());
  }

  get session(): ShopSession { return this.d.session; }
  get collector(): HoverCollector { return this.d.collector; }
  get mode(): ScanMode { return this.d.engine.settings.mode; }
  get capturing(): boolean { return this.d.capture.active; }
  /** a share or a screenshot is there to read */
  get canScan(): boolean { return this.capturing || this.still != null; }
  /** the shop list is found by itself, not read from a marked area */
  get autoArea(): boolean { return this.d.engine.settings.area !== 'manual'; }
  /** in deals mode, with the area to be marked by hand and none marked yet: nothing can be read */
  get needsShopArea(): boolean { return this.mode === 'deals' && !this.autoArea && !this.d.shopRegion(); }

  /** For troubleshooting: what the mode's reader read last, the shop's list or your item's tooltip. */
  get seen(): I | null { return this.mode === 'inventory' ? this.d.hovers.lastCrop : this.d.shop.lastCrop; }

  /** For troubleshooting: what a check reads now. */
  readTarget(): ReadTarget {
    if (this.mode === 'inventory') return !this.d.collector.scanning ? 'paused' : this.d.itemsArea() ? 'items-marked' : 'items';
    return this.autoArea ? (this.d.shop.found ? 'shop-found' : 'shop-looking') : this.d.shopRegion() ? 'shop-marked' : 'shop-unset';
  }

  on(listener: (c: ScanChange) => void): void { this.listeners.push(listener); }
  private emit(c: ScanChange): void { for (const l of this.listeners) l(c); }

  /** Tells the listeners when the status line's words or state changed. */
  private statusChanged(): void {
    const s = this.status(), key = `${s.state}|${s.html}|${this.error ?? ''}|${this.capturing}`;
    if (key === this.shown) return;
    this.shown = key;
    this.emit({ kind: 'status' });
  }

  /**
   * Deals or inventory. Inventory closes the open shop and forgets its hovered item; deals pauses scanning
   * your items. The setting changes; saving it is the caller's.
   */
  setMode(mode: ScanMode): void {
    if (mode === this.mode) return;
    this.generation++;
    this.d.engine.settings.mode = mode;
    if (mode === 'inventory') {
      this.d.session.close();
      this.d.session.forgetHover();
      this.d.shop.reset();
      this.emit({ kind: 'shop' });
    } else {
      this.setScanning(false);
    }
    this.statusChanged();
    if (this.canScan) void this.tick(true);
  }

  /** Turns scanning your items on or off. It can't start with nothing to read. Returns whether it is on. */
  setScanning(on: boolean): boolean {
    const c = this.d.collector;
    if (on && !this.canScan) return false;
    if (c.scanning === on) return on;
    if (!on) this.generation++;
    c.scanning = on;
    c.noTooltip();
    this.emit({ kind: 'hover', event: null });
    this.statusChanged();
    if (on) void this.tick();
    return on;
  }

  private async loadReader(): Promise<boolean> {
    if (this.d.reader.ready) return true;
    this.loading = true;
    this.statusChanged();
    try { await this.d.reader.load(); return true; } catch (e) {
      console.error(e);
      this.error = READER_FAILED;
      return false;
    } finally {
      this.loading = false;
      this.statusChanged();
    }
  }

  /** Asks for the screen share and starts checking it. Returns whether it started; if not, `error` says why. */
  async startCapture(): Promise<boolean> {
    this.error = null;
    try {
      await this.d.capture.start(() => this.stopCapture());
    } catch (e) {
      if (!(e instanceof CaptureFailed)) throw e;
      this.error = captureErrorText(e);
      this.statusChanged();
      return false;
    }
    this.still = null;
    this.failures = 0;   // the status line says what it reads again at the end of the check
    this.d.shop.reset();
    this.statusChanged();
    if (!(await this.loadReader())) return false;
    this.restartTicker();
    void this.tick(true);
    return true;
  }

  /** The error was read: the bar under the capture control goes. */
  dismissError(): void {
    this.error = null;
    this.statusChanged();
  }

  stopCapture(): void {
    this.generation++;
    this.failures = 0;   // the status line says what it reads again at the end of the check
    this.setScanning(false);
    this.ticker.stop();
    this.d.capture.stop();
    this.d.session.close();
    this.emit({ kind: 'shop' });
    this.statusChanged();
  }

  /** The check interval changed: check at the new pace. */
  restartTicker(): void {
    if (this.capturing) this.ticker.start(Math.max(400, Math.round(this.d.engine.settings.interval * 1000)));
  }

  /** Reads a screenshot instead of the share. Returns false when it could not be read: no reader, or no shop area marked. */
  async useStill(frame: F): Promise<boolean> {
    await this.running;   // a check of the picture before ends first
    this.generation++;    // and one asked for meanwhile, which would read the picture before, is dropped
    this.still = frame;
    this.d.shop.reset();
    this.d.session.close();
    this.d.collector.noTooltip();
    this.emit({ kind: 'shop' });
    if (!(await this.loadReader())) return false;
    if (this.needsShopArea) { this.statusChanged(); return false; }
    await this.tick(true);
    return true;
  }

  /** The shop area, or how it is found, changed: read the screen afresh. */
  areaChanged(): void {
    this.d.shop.reset();
    this.statusChanged();
    if (this.canScan) void this.tick(true);
  }

  /** A frame for the marking dialog: the screenshot, or the share's (waiting a moment for a first one). */
  async grab(): Promise<FrameGrab<F> | null> {
    if (this.still) return { frame: this.still, done: () => {} };
    return this.capturing ? this.d.capture.grabSoon() : null;
  }

  /**
   * One check of the screen, by the mode's reader. `force` reads even if the screen looks unchanged. While a
   * check is under way, a plain one waits for it; a forced one runs once it ends (one, however many are asked for).
   */
  tick(force = false): Promise<void> {
    if (this.running) {
      if (!force) return this.running;
      return (this.next ??= this.running.then(() => { this.next = null; return this.tick(true); }));
    }
    if (!this.d.reader.ready || !this.canScan) return Promise.resolve();
    // a check never fails its callers: what went wrong is logged, and the next check runs as usual
    this.running = this.check(force).catch((e: unknown) => { console.error(e); }).finally(() => { this.running = null; });
    return this.running;
  }

  private async check(force: boolean): Promise<void> {
    const { session, collector, shop, hovers, engine } = this.d;
    const mode = this.mode, live = !this.still, generation = this.generation;
    const shopV = session.version, hoverV = collector.version;
    let event: HoverEvent | null = null;
    let list, tip;
    try {
      const g = this.still ? { frame: this.still, done: () => {} } : await this.d.capture.grab();
      if (!g) return;
      try {
        if (mode === 'deals' && !this.needsShopArea) {
          list = shop.prepare(g.frame, { auto: this.autoArea, region: this.d.shopRegion(), readStats: engine.settings.readStats !== 'off', live, force });
        } else if (mode === 'inventory' && collector.scanning) {
          tip = hovers.prepare(g.frame, { live, area: this.d.itemsArea() });
        }
      } finally { g.done(); }
    } catch (e) {
      // once is nothing to worry about; several checks in a row are, and the status line says so
      console.error(e);
      if (++this.failures === FAILS_TO_TELL) this.statusChanged();
      return;
    }
    this.failures = 0;   // the status line says what it reads again at the end of the check
    // a check that ends after a reset (see `generation`) is dropped: what it read is for what was there before
    const keep = () => this.generation === generation;
    if (list) { try { await shop.read(list, keep); } catch (e) { console.error(e); } }
    if (tip) { try { event = await hovers.read(tip, keep); } catch (e) { console.error(e); } }
    if (!keep()) { this.statusChanged(); return; }   // `failures` was just reset: the status line may say so
    this.scans++;
    if (session.version !== shopV) this.emit({ kind: 'shop' });
    if (collector.version !== hoverV || event) this.emit({ kind: 'hover', event });
    this.statusChanged();
    this.emit({ kind: 'checked' });
  }

  /** What the scanner is doing, in a line, per mode. */
  status(): ScanStatus {
    if (this.loading) return { state: 'busy', html: 'Loading the text reader (about 3 MB, first time only)…' };
    if (!this.canScan) return { state: 'idle', html: IDLE };
    if (this.failures >= FAILS_TO_TELL) return { state: 'busy', html: CANT_READ };
    const shot = !this.capturing;
    if (this.mode === 'inventory') {
      return this.d.collector.scanning
        ? { state: 'watching', html: '<b>Scanning your items.</b> Point at items in the game and they are added.' }
        : { state: 'idle', html: '<b>Not scanning your items.</b> Press Scan my items.' };
    }
    if (this.needsShopArea) return { state: 'busy', html: '<b>Mark the shop area</b> in Settings so the scanner knows where to read.' };
    const s = this.d.session;
    if (s.open) {
      const n = s.listingCount();
      return { state: 'shop', html: `<b>Shop open</b>, ${n} listing${n === 1 ? '' : 's'} read in ${Math.round(this.d.shop.ocrMs)} ms` };
    }
    if (shot) {
      return {
        state: 'watching',
        html: this.autoArea && !this.d.shop.found
          ? '<b>Screenshot loaded</b>, but no shop window found in it. If one is there, mark the shop area in Settings.'
          : '<b>Screenshot loaded</b>, but no listings read in the shop area.',
      };
    }
    return {
      state: 'watching',
      html: '<b>Watching for shops.</b> Open a shop in the game.'
        + (this.d.capture.sharingWholeScreen() ? ' With the whole screen shared, it only sees the game while the game is in front.' : ''),
    };
  }
}
