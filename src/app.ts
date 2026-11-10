import { cleanEntries } from './appraisal/entries';
import { HoverScanner } from './appraisal/hoverScan';
import { ScreenCapture } from './capture/screen';
import { Ticker } from './capture/ticker';
import type { Engine } from './engine';
import type { HoverEvent } from './appraisal/hovers';
import type { MarketData, PriceBook, Region, Settings } from './lib/types';
import { loadCatalog } from './market/catalog';
import { MarketIndex } from './market/marketIndex';
import { Reader } from './ocr/reader';
import { isPriceBook, mergeBackup, pruneOld } from './pricing/priceBook';
import { ScanController, type ScanChange } from './scan/controller';
import { Scanner } from './scan/scanner';
import { ShopSession, type Deal } from './shop/session';
import { Storage } from './store/storage';
import { Calibration, type AreaKind } from './ui/calibrate';
import { CaptureBar } from './ui/captureBar';
import { DealsView } from './ui/dealsView';
import { $, onFile } from './ui/dom';
import { InventoryView } from './ui/inventoryView';
import { Overlay } from './ui/overlay';
import { PricesView, tidyBook } from './ui/pricesView';
import { SettingsBinder } from './ui/settingsBind';
import { SettingsView } from './ui/settingsView';
import { Shell } from './ui/shell';
import { Chime } from './ui/sound';
import { freshDeal, hoverText, overlayHtml } from './ui/views';
import { canvasAdapter, type Frame } from './vision/canvas';

/** The page: builds the scanning and the views, and connects them. */
export class App {
  readonly store = new Storage();
  readonly engine: Engine;
  readonly session: ShopSession;
  readonly reader = new Reader();
  readonly scanner: Scanner<Frame, HTMLCanvasElement>;
  readonly capture = new ScreenCapture();
  readonly controller: ScanController<Frame, HTMLCanvasElement>;
  private readonly overlay = new Overlay();
  private readonly chime = new Chime();
  private readonly calibration: Calibration;
  private readonly shell: Shell;
  private readonly bar: CaptureBar;
  private readonly deals: DealsView;
  private readonly inventory: InventoryView;
  private readonly prices: PricesView;
  private readonly settingsView: SettingsView;
  private readonly binder: SettingsBinder;
  private region: Region | null;
  /** the area marked for your items' hovers */
  private itemsRegion: Region | null;
  /** icon addresses that failed to load: show the emoji instead from now on */
  private readonly failedIcons = new Set<string>();
  private wipeArmed = 0;

  constructor() {
    const book = this.store.loadBook();
    this.engine = { market: new MarketIndex(this.store.loadMarket()), facts: new Map(), book, settings: this.store.loadSettings(), now: () => Date.now() };
    pruneOld(book, Date.now());
    this.region = this.store.loadRegion();
    this.itemsRegion = this.store.loadItemsRegion();
    const e = this.engine, failed = this.failedIcons;

    this.session = new ShopSession(e, { onDeal: (d) => this.onDeal(d) });
    this.scanner = new Scanner(canvasAdapter, this.reader, this.session, e, { onBook: () => this.saveBook() });
    this.inventory = new InventoryView({
      engine: e, store: this.store, failed, region: () => this.itemsRegion, setScanning: (on) => this.setScanning(on),
    });
    this.controller = new ScanController({
      engine: e, capture: this.capture, reader: this.reader, repeat: (tick) => new Ticker(tick),
      session: this.session, shop: this.scanner,
      collector: this.inventory.collector, hovers: new HoverScanner(canvasAdapter, this.reader, this.inventory.collector, e),
      shopRegion: () => this.region, itemsArea: () => this.inventory.area(),
    });
    this.controller.on((c) => this.changed(c));

    this.deals = new DealsView({ engine: e, session: this.session, failed, saveSettings: () => this.saveSettings(), sorted: () => this.renderOverlay() });
    this.prices = new PricesView({
      engine: e, failed, saveBook: () => this.saveBook(), setMarket: (m) => this.setMarket(m), changed: () => this.pricesChanged(),
    });
    this.settingsView = new SettingsView($('view-settings'), {
      canScan: () => this.controller.canScan,
      markShop: () => void this.calibration.open('shop'),
      markItems: () => void this.calibration.open('items'),
      loadShot: (f) => this.loadScreenshot(f),
      diag: () => this.diag(),
    });
    this.binder = new SettingsBinder(e.settings, (key) => this.settingChanged(key));
    this.bar = new CaptureBar(this.controller, {
      start: () => { this.chime.unlock(); void this.controller.startCapture(); },
      stop: () => this.controller.stopCapture(),
      overlay: () => void this.openOverlay(),
      dismissError: () => this.controller.dismissError(),
    });
    this.shell = new Shell({
      settings: e.settings, save: () => this.saveSettings(), setMode: (m) => this.controller.setMode(m), shown: () => this.render(),
    });
    this.calibration = new Calibration({
      grab: () => this.controller.grab(),
      capturing: () => this.capture.active,
      sharingWholeScreen: () => this.capture.sharingWholeScreen(),
      framesIn: () => this.capture.framesIn,
      auto: () => this.controller.autoArea,
      region: (kind: AreaKind) => (kind === 'items' ? this.itemsRegion : this.region),
      ocr: this.reader,
      save: (r, kind: AreaKind) => (kind === 'items' ? this.saveItemsRegion(r) : this.saveRegion(r)),
      chime: () => this.chime.play(),
    });
  }

  start(): void {
    this.bar.wire();
    this.deals.wire();
    this.inventory.wire();
    this.prices.wire();
    this.settingsView.wire();
    this.wireData();
    this.binder.bind(document);
    const fixed = tidyBook(this.engine);
    if (fixed) { this.saveBook(); $('dataMsg').textContent = fixed; }
    this.shell.start();
    document.addEventListener('error', (e) => { const t = e.target as Element | null; if (t?.tagName === 'IMG') this.iconFailed(t as HTMLImageElement); }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'FM Deal Scanner'; });
    // times like "opened 3:41 PM" and the banner's 5 minutes move on even when nothing is read
    setInterval(() => { if (!document.hidden) { this.deals.render(); this.renderOverlay(); } }, 15_000);
    setInterval(() => this.settingsView.renderDiag(), 1000);
    void this.loadCatalog();
  }

  /** Item ids by name, so items the tracker doesn't list (or all of them, with no tracker page loaded) get pictures. */
  private async loadCatalog(): Promise<void> {
    const catalog = await loadCatalog(`${import.meta.env.BASE_URL}items.json`);
    if (!catalog.size) return;
    this.engine.market = this.engine.market.withCatalog(catalog);
    this.render();
  }

  private get settings(): Settings { return this.engine.settings; }

  // ---------- what the scanning tells ----------

  private changed(c: ScanChange): void {
    if (c.kind === 'shop') { this.deals.render(); this.prices.render(); }
    else if (c.kind === 'hover') this.hoverChanged(c.event);
    else if (c.kind === 'status') { this.bar.render(); this.settingsView.render(); }
    else {
      document.body.dataset.scans = String(this.controller.scans);
      if (this.scanner.lastCrop) this.settingsView.drawSeen(this.scanner.lastCrop);
      return;
    }
    this.renderOverlay();
  }

  private hoverChanged(ev: HoverEvent | null): void {
    if (!ev) { this.inventory.scanningChanged(); return; }
    if (ev.kind === 'added' && this.settings.sound) this.chime.tick();
    this.inventory.showEvent(ev);
  }

  private onDeal(d: Deal): void {
    if (this.settings.sound) this.chime.play();
    if (document.hidden) document.title = `● Deal: ${d.name}`;
    this.deals.flash();
  }

  private setScanning(on: boolean): boolean {
    this.chime.unlock();
    return this.controller.setScanning(on);
  }

  async loadScreenshot(f: File): Promise<void> {
    this.chime.unlock();
    const read = await this.controller.useStill(await createImageBitmap(f));
    if (!read && this.controller.needsShopArea) await this.calibration.open('shop');
  }

  private saveItemsRegion(r: Region): void {
    this.itemsRegion = r;
    this.store.saveItemsRegion(r);
    this.settings.appraisalArea = 'marked';
    this.binder.show('appraisalArea');
    this.saveSettings();
    this.inventory.setHint('Area saved. Only tooltips beside it are counted now.');
    this.render();
  }

  private saveRegion(r: Region): void {
    this.region = r;
    this.store.saveRegion(r);
    this.settings.area = 'manual';
    this.binder.show('area');
    this.saveSettings();
    this.controller.areaChanged();
  }

  // ---------- settings and data ----------

  private saveSettings(): void { this.store.saveSettings(this.settings); }

  /** A setting changed in one of its controls: it is kept, and does what it does. */
  private settingChanged(key: keyof Settings): void {
    this.saveSettings();
    if (key === 'interval') this.controller.restartTicker();
    else if (key === 'area') this.controller.areaChanged();
    else if (key === 'sound' && this.settings.sound) { this.chime.unlock(); this.chime.play(); }
    else if (key === 'appraisalArea') {
      this.inventory.setHint(this.settings.appraisalArea === 'marked' && !this.itemsRegion ? 'Press Mark the inventory area in Settings to draw the box around your item slots.' : '');
    }
    this.pricesChanged();
  }

  /** Something that prices items changed: the shop is judged again, and every view drawn. */
  private pricesChanged(): void {
    this.session.reevaluate();
    this.render();
  }

  private saveBook(): void { this.store.saveBook(this.engine.book); }

  private setMarket(m: MarketData): boolean {
    this.engine.market = new MarketIndex(m, this.engine.market.catalog);
    return this.store.saveMarket(m);
  }

  private wireData(): void {
    $('btnExport').addEventListener('click', () => {
      const body = JSON.stringify({ version: 1, exported: new Date().toISOString(), db: this.engine.book, settings: this.settings, region: this.region, appraisal: this.inventory.entries() }, null, 1);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = `fm-deal-scanner-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('dataMsg').textContent = 'Exported.';
    });
    onFile('fileImport', async (f) => {
      try {
        const j = JSON.parse(await f.text()) as { db?: unknown; region?: Region | null; appraisal?: unknown };
        if (!isPriceBook(j.db)) throw new Error('not a scanner backup');
        const n = mergeBackup(this.engine.book, j.db as PriceBook);
        if (j.region) { this.region = j.region; this.store.saveRegion(j.region); }
        tidyBook(this.engine);
        this.saveBook();
        const lines = this.inventory.importEntries(cleanEntries(j.appraisal));
        this.pricesChanged();
        $('dataMsg').textContent = `Imported ${n} item${n === 1 ? '' : 's'}.` + (lines ? ` Added ${lines} appraisal line${lines === 1 ? '' : 's'}.` : '');
      } catch { $('dataMsg').textContent = 'That file is not a scanner backup.'; }
    });
    const wipe = $('btnWipe');
    wipe.addEventListener('click', () => {
      if (Date.now() - this.wipeArmed > 4000) {
        this.wipeArmed = Date.now();
        wipe.textContent = 'Click again to clear';
        setTimeout(() => { wipe.textContent = 'Clear all sightings'; }, 4000);
        return;
      }
      for (const it of Object.values(this.engine.book.items)) it.s = [];
      this.wipeArmed = 0; wipe.textContent = 'Clear all sightings';
      this.saveBook(); this.pricesChanged();
      $('dataMsg').textContent = 'Sightings cleared. Your typed prices stay.';
    });
  }

  // ---------- drawing ----------

  render(): void {
    this.bar.render();
    this.deals.render();
    this.inventory.render();
    this.prices.render();
    this.settingsView.render();
    this.renderOverlay();
  }

  private iconFailed(img: HTMLImageElement): void {
    if (!img.closest('.ico')) return;
    this.failedIcons.add(img.getAttribute('src') ?? '');
    img.remove();
  }

  private renderOverlay(): void {
    if (!this.overlay.win) return;
    const h = this.session.hover, mode = this.controller.mode;
    this.overlay.render(overlayHtml({
      mode, open: this.session.open, capturing: this.capture.active, scanning: this.inventory.scanning, rows: this.deals.rows(),
      deal: freshDeal(this.session, Date.now()), hover: hoverText(h, this.engine), hoverKey: h?.key ?? null,
    }, this.engine.market, this.failedIcons, mode === 'inventory' ? this.inventory.overlayHtml() : ''));
  }

  /** Live capture health, so a broken share is obvious at a glance. */
  private diag(): string {
    if (!this.capture.active) return '';
    const { surface, size } = this.capture.describe();
    const idle = this.capture.latestAt ? Math.round((Date.now() - this.capture.latestAt) / 1000) : null;
    return `sharing ${surface === 'monitor' ? 'whole screen' : surface} ${size} · ${this.capture.framesIn} frames received`
      + (idle != null && idle > 5 ? ` · none new for ${idle}s (normal while the screen is still)` : '')
      + ` · text reader ${this.reader.ready ? 'ready' : 'loading'}`
      + ` · area ${this.controller.autoArea ? (this.scanner.found ? 'found automatically' : 'looking for a shop') : this.region ? 'marked by you' : 'not set'}`;
  }

  private async openOverlay(): Promise<void> {
    if (!Overlay.supported()) { $('btnPip').textContent = 'Overlay needs Chrome 116+'; return; }
    try {
      await this.overlay.open((img) => this.iconFailed(img), (act) => { if (act === 'scan') this.inventory.toggleScanning(); });
      this.renderOverlay();
    } catch (e) { console.warn(e); }
  }
}
