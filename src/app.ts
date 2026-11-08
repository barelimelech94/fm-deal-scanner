import { cleanEntries } from './appraisal/entries';
import { HoverScanner } from './appraisal/hoverScan';
import { CaptureFailed, ScreenCapture, type Grab } from './capture/screen';
import { Ticker } from './capture/ticker';
import type { Engine } from './engine';
import { cap, clock, esc, fmt } from './lib/format';
import { parseAmount } from './lib/text';
import type { MarketData, PriceBook, Region, Settings } from './lib/types';
import { loadCatalog } from './market/catalog';
import { MarketIndex } from './market/marketIndex';
import { resolveKey } from './market/matching';
import { parseTrackerPage } from './market/parseTrackerPage';
import { Reader } from './ocr/reader';
import { fixSetSightings, isPriceBook, mergeBackup, mergeIntoMarket, newItem, pruneOld } from './pricing/priceBook';
import { Scanner } from './scan/scanner';
import { ShopSession, type Deal } from './shop/session';
import { Storage } from './store/storage';
import { AppraisalPanel } from './ui/appraisalPanel';
import { Calibration, type AreaKind } from './ui/calibrate';
import { $ } from './ui/dom';
import { Overlay } from './ui/overlay';
import { Chime } from './ui/sound';
import {
  bookRowHtml, bookRows, dealLine, dealsHtml, freshDeal, hoverText, iconHtml, marketInfo, overlayHtml,
  cleanSort, nextSort, parsePriceLines, rulesSummary, shopMeta, shopRowHtml, sortRows, type BookSort, type ShopSort,
} from './ui/views';
import { canvasAdapter, type Frame } from './vision/canvas';

const BOOK_MAX = 250;
const IDLE = 'Not capturing. Press <b>Start capture</b> and pick the MapleStory window.';
const PREVIEW = 'Screen capture is blocked because this page is open inside a preview or frame. Open it in its own Chrome tab.';
const MACPERM = 'macOS refused the capture. In System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, turn Chrome off and on again, then <b>quit Chrome with ⌘Q</b> and reopen it. Chrome only picks up that setting after a full restart.';

/** Rules inputs and the settings they edit. */
const SETTING_INPUTS: Record<string, keyof Settings> = {
  setDiscount: 'discount', setMinProfit: 'minProfit', setFee: 'fee', setBase: 'base', setMarket: 'market', setArea: 'area',
  setStats: 'readStats', setStatPct: 'statPct', setSlotWorth: 'slotWorth', setNpc: 'npcRatio', setMinSeen: 'minSeen', setInterval: 'interval',
};

/** The page: wires the capture, the scanner and the shop to the controls and the tables. */
export class App {
  readonly store = new Storage();
  readonly engine: Engine;
  readonly session: ShopSession;
  readonly reader = new Reader();
  readonly scanner: Scanner<Frame, HTMLCanvasElement>;
  readonly capture = new ScreenCapture();
  private readonly ticker = new Ticker(() => void this.scan(false));
  private readonly overlay = new Overlay();
  private readonly chime = new Chime();
  private readonly calibration: Calibration;
  private readonly appraisal: AppraisalPanel;
  private readonly hoverScanner: HoverScanner<Frame, HTMLCanvasElement>;
  /** a screenshot picked with "Test with a screenshot" */
  private still: ImageBitmap | null = null;
  private region: Region | null;
  /** the area marked for the appraisal's hovers */
  private itemsRegion: Region | null;
  private sort: BookSort = { col: 'last', dir: -1 };
  /** icon addresses that failed to load: show the emoji instead from now on */
  private readonly failedIcons = new Set<string>();
  private wipeArmed = 0;

  constructor() {
    const book = this.store.loadBook();
    this.engine = { market: new MarketIndex(this.store.loadMarket()), book, settings: this.store.loadSettings(), now: () => Date.now() };
    pruneOld(book, Date.now());
    this.region = this.store.loadRegion();
    this.itemsRegion = this.store.loadItemsRegion();
    this.appraisal = new AppraisalPanel({
      engine: this.engine, store: this.store, failed: this.failedIcons,
      region: () => this.itemsRegion,
      canScan: () => this.capture.active || !!this.still,
      onMark: () => void this.calibration.open('items'),
      onScan: (on) => this.scanningChanged(on),
    });
    this.hoverScanner = new HoverScanner(canvasAdapter, this.reader, this.appraisal.collector, this.engine);
    this.session = new ShopSession(this.engine, { onDeal: (d) => this.onDeal(d) });
    this.scanner = new Scanner(canvasAdapter, this.reader, this.session, this.engine, { onBook: () => this.saveBook() });
    this.calibration = new Calibration({
      grab: () => this.grab(),
      capturing: () => this.capture.active,
      sharingWholeScreen: () => this.capture.sharingWholeScreen(),
      framesIn: () => this.capture.framesIn,
      auto: () => this.auto(),
      region: (kind: AreaKind) => (kind === 'items' ? this.itemsRegion : this.region),
      ocr: this.reader,
      save: (r, kind: AreaKind) => (kind === 'items' ? this.saveItemsRegion(r) : this.saveRegion(r)),
      chime: () => this.chime.play(),
    });
  }

  start(): void {
    this.wire();
    this.appraisal.wire();
    const fixed = this.tidyBook();
    if (fixed) $('dataMsg').textContent = fixed;
    this.render();
    this.setStatus('idle', IDLE);
    document.addEventListener('error', (e) => { const t = e.target as Element | null; if (t?.tagName === 'IMG') this.iconFailed(t as HTMLImageElement); }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'FM Deal Scanner'; });
    // times like "opened 3:41 PM" and the banner's 5 minutes move on even when nothing is read
    setInterval(() => { if (!document.hidden) { this.renderShop(); this.renderOverlay(); } }, 15_000);
    setInterval(() => this.renderDiag(), 1000);
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
  private auto(): boolean { return this.settings.area !== 'manual'; }

  // ---------- scanning ----------

  private async grab(): Promise<Grab | null> {
    if (this.still) { const f = this.still; return { frame: f, done: () => {} }; }
    return this.capture.grabSoon();
  }

  async scan(force: boolean): Promise<void> {
    const hovers = this.appraisal.scanning, shop = this.auto() || !!this.region;
    if (this.scanner.busy || this.hoverScanner.busy || !this.reader.ready) return;
    if (!shop && !hovers) return;
    const g = this.still ? { frame: this.still as Frame, done: () => {} } : await this.capture.grab();
    if (!g) return;
    let prepared, hover;
    try {
      if (shop) {
        prepared = this.scanner.prepare(g.frame, {
          auto: this.auto(), region: this.region, readStats: this.settings.readStats !== 'off', live: !this.still, force,
        });
      }
      // a shop list on screen means a shop is open, and the hovers over it belong to the shop
      if (hovers && !prepared?.list) hover = this.hoverScanner.prepare(g.frame, { live: !this.still, area: this.appraisal.area() });
    } finally { g.done(); }
    if (prepared) {
      try { await this.scanner.read(prepared); } catch (e) { console.error(e); }
      if (this.scanner.lastCrop) this.drawSeen(this.scanner.lastCrop);
    }
    if (hover) {
      try {
        const ev = await this.hoverScanner.read(hover);
        if (ev.kind === 'added' && this.settings.sound) this.chime.tick();
        this.appraisal.showEvent(ev);
      } catch (e) { console.error(e); }
    }
    document.body.dataset.scans = String(this.scanner.scans);
    this.render();
  }

  private onDeal(d: Deal): void {
    if (this.settings.sound) this.chime.play();
    if (document.hidden) document.title = `● Deal: ${d.name}`;
    const b = $('dealBanner');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  }

  private async loadReader(): Promise<boolean> {
    if (this.reader.ready) return true;
    this.setStatus('busy', 'Loading the text reader (about 3 MB, first time only)…');
    try { await this.reader.load(); return true; } catch (e) {
      console.error(e);
      this.setStatus('error', 'The text reader failed to load. Check your internet connection and reload this page.');
      return false;
    }
  }

  async startCapture(): Promise<void> {
    this.chime.unlock();
    try {
      await this.capture.start(() => this.stopCapture());
    } catch (e) {
      if (!(e instanceof CaptureFailed)) throw e;
      const text = e.kind === 'unsupported' ? PREVIEW : e.kind === 'blocked-by-system' ? MACPERM
        : e.kind === 'cancelled' ? `Capture was cancelled. Press <b>Start capture</b>, choose the <b>Window</b> tab, select MapleStory and press <b>Share</b>. If no picker appeared at all: ${MACPERM}`
        : 'Capture failed.';
      this.setStatus('error', `${text}${e.detail ? ` <span class="dim">(${esc(e.detail)})</span>` : ''}`);
      return;
    }
    this.still = null;
    this.scanner.reset();
    $('btnStart').hidden = true; $('btnStop').hidden = false;
    $<HTMLButtonElement>('btnArea').disabled = false;
    $<HTMLButtonElement>('btnPip').disabled = false;
    if (!(await this.loadReader())) return;
    this.refreshStatus();
    this.ticker.start(Math.max(400, Math.round(this.settings.interval * 1000)));
    void this.scan(true);
  }

  stopCapture(): void {
    this.appraisal.setScanning(false);
    this.ticker.stop();
    this.capture.stop();
    this.session.close();
    $('btnStart').hidden = false; $('btnStop').hidden = true;
    $<HTMLButtonElement>('btnArea').disabled = !this.still;
    this.setStatus('idle', IDLE);
    this.render();
  }

  async loadScreenshot(f: File): Promise<void> {
    this.chime.unlock();
    this.still = await createImageBitmap(f);
    this.scanner.reset();
    this.session.close();
    $<HTMLButtonElement>('btnArea').disabled = false;
    if (!(await this.loadReader())) return;
    if (!this.auto() && !this.region) await this.calibration.open();
    else await this.scan(true);
    this.refreshStatus();
  }

  /** Appraisal scanning was turned on or off: the screen is checked now, and the status and overlay follow. */
  private scanningChanged(on: boolean): void {
    this.chime.unlock();
    this.refreshStatus();
    this.renderOverlay();
    if (on) void this.scan(false);
  }

  private saveItemsRegion(r: Region): void {
    this.itemsRegion = r;
    this.store.saveItemsRegion(r);
    this.settings.appraisalArea = 'marked';
    this.store.saveSettings(this.settings);
    this.appraisal.setHint('Area saved. Only tooltips beside it are counted now.');
    this.render();
  }

  private saveRegion(r: Region): void {
    this.region = r;
    this.store.saveRegion(r);
    this.settings.area = 'manual';
    this.store.saveSettings(this.settings);
    $<HTMLSelectElement>('setArea').value = 'manual';
    this.scanner.reset();
    void this.scan(true);
    this.refreshStatus();
  }

  // ---------- data ----------

  private saveBook(): void { this.store.saveBook(this.engine.book); }

  /** Moves misread names onto the tracker's, and old star sightings to per-set prices. */
  private tidyBook(): string {
    const merged = mergeIntoMarket(this.engine.book, this.engine.market), sets = fixSetSightings(this.engine.book, this.engine.market);
    if (merged || sets) this.saveBook();
    return [
      merged ? `Merged ${merged} price-book entr${merged === 1 ? 'y' : 'ies'} into the tracker's name for the same item.` : '',
      sets ? `Fixed ${sets} old star sighting${sets === 1 ? '' : 's'} that were priced per star instead of per set.` : '',
    ].filter(Boolean).join(' ');
  }

  private setMarket(m: MarketData): boolean {
    this.engine.market = new MarketIndex(m, this.engine.market.catalog);
    return this.store.saveMarket(m);
  }

  private reevaluate(): void { this.session.reevaluate(); }

  // ---------- rendering ----------

  private setStatus(state: string, html: string): void {
    $('status').dataset.state = state;
    $('statusText').innerHTML = html;
    this.renderOverlay();
  }

  private refreshStatus(): void {
    if (!this.capture.active && !this.still) return;
    if (!this.auto() && !this.region) { this.setStatus('busy', '<b>Mark the shop area</b> so the scanner knows where to read.'); return; }
    if (this.appraisal.scanning && !this.session.open) {
      this.setStatus('watching', '<b>Scanning hovers.</b> Point at items in the game and they are added to the appraisal.');
      return;
    }
    if (this.session.open) {
      const n = this.session.listingCount();
      this.setStatus('shop', `<b>Shop open</b>, ${n} listing${n === 1 ? '' : 's'} read in ${Math.round(this.scanner.ocrMs)} ms`);
      return;
    }
    if (this.still && !this.capture.active) {
      this.setStatus('watching', this.auto() && !this.scanner.found
        ? '<b>Screenshot loaded</b>, but no shop window found in it. If one is there, use <b>Mark shop area</b>.'
        : '<b>Screenshot loaded</b>, but no listings read in the shop area.');
      return;
    }
    this.setStatus('watching', '<b>Watching.</b> Open a shop in the game.'
      + (this.capture.sharingWholeScreen() ? ' With the whole screen shared, it only sees the game while the game is in front.' : ''));
  }

  render(): void {
    $('rulesSum').textContent = rulesSummary(this.settings);
    $('marketAge').innerHTML = marketInfo(this.engine.market, Date.now());
    this.renderShop();
    this.renderDeals();
    if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('cellinput'))) this.renderBook();
    this.appraisal.render();
    this.refreshStatus();
    this.renderOverlay();
  }

  private icon(key: string): string { return iconHtml(this.engine.market, key, this.failedIcons); }

  private iconFailed(img: HTMLImageElement): void {
    if (!img.closest('.ico')) return;
    this.failedIcons.add(img.getAttribute('src') ?? '');
    img.remove();
  }

  /** How the open shop is ordered, from the saved setting. */
  private shopSort(): ShopSort { return cleanSort(this.settings.shopSort, this.settings.shopSortDir); }

  private setShopSort(s: ShopSort): void {
    this.settings.shopSort = s.col;
    this.settings.shopSortDir = s.dir;
    this.store.saveSettings(this.settings);
    this.renderShop();
    this.renderOverlay();
  }

  /** Arrows and aria on the shop table's headers, and the way back to the default order. */
  private renderShopHeaders(): void {
    const s = this.shopSort();
    for (const th of document.querySelectorAll<HTMLElement>('#shopTable th.sortable')) {
      const on = th.dataset.col === s.col;
      th.innerHTML = (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${s.dir > 0 ? '▲' : '▼'}</span>` : '');
      th.setAttribute('aria-sort', on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    $('shopSortReset').hidden = s.col === 'best';
  }

  private renderShop(): void {
    this.renderShopHeaders();
    const rows = sortRows(this.session.displayRows(), this.shopSort());
    const m = this.engine.market;
    const table = $<HTMLTableElement>('shopTable');
    table.tBodies[0]!.innerHTML = rows.map((r) => shopRowHtml(r, m, this.failedIcons)).join('');
    table.hidden = !rows.length;
    $('shopEmpty').hidden = !!rows.length;
    $('shopMeta').textContent = shopMeta(this.session, rows);
    const hv = hoverText(this.session.hover, this.engine);
    $('hoverLine').hidden = !hv;
    if (hv && this.session.hover) $('hoverLine').innerHTML = `${this.icon(this.session.hover.key)}<span><b>Hovered</b> ${esc(hv)}</span>`;
    const d = freshDeal(this.session, Date.now());
    $('dealBanner').hidden = !d;
    if (d) {
      const l = dealLine(d, m);
      $('dealLabel').textContent = `Deal at ${clock(d.ts)}`;
      $('dealWhat').innerHTML = `${this.icon(d.key)}<span>${esc(l.name)}</span>`;
      $('dealMath').textContent = `${cap(l.listing)}, ${l.why}`;
      $('dealProfit').innerHTML = l.profit ? `${esc(l.profit)}<small>${esc(l.profitNote)}</small>` : '';
    }
  }

  private renderDeals(): void {
    $('dealList').innerHTML = dealsHtml(this.session.deals, this.engine.market, this.failedIcons);
    $('dealsEmpty').hidden = this.session.deals.length > 0;
  }

  private renderBook(): void {
    const q = $<HTMLInputElement>('bookSearch').value;
    const all = bookRows(this.engine, q, this.sort), rows = all.slice(0, BOOK_MAX), now = Date.now();
    $<HTMLTableElement>('bookTable').tBodies[0]!.innerHTML = rows.map((r) => bookRowHtml(r, now, this.failedIcons)).join('');
    const empty = $('bookEmpty');
    empty.hidden = rows.length > 0;
    empty.textContent = q.trim() ? 'Nothing matches that name.' : 'Empty. It fills as you open shops, or paste prices below.';
    const hint = $('bookHint');
    hint.textContent = all.length > BOOK_MAX ? `Showing ${BOOK_MAX} of ${fmt(all.length)}. Type more of the name to narrow it.`
      : !q.trim() && this.engine.market.size ? `Type in the filter to find any of the ${fmt(this.engine.market.size)} items the price tracker lists, and set your own price or buy-under on it.` : '';
    hint.hidden = !hint.textContent;
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      const on = th.dataset.col === this.sort.col;
      th.innerHTML = (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${this.sort.dir > 0 ? '▲' : '▼'}</span>` : '');
      th.setAttribute('aria-sort', on ? (this.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
  }

  private renderOverlay(): void {
    if (!this.overlay.win) return;
    const h = this.session.hover;
    this.overlay.render(overlayHtml({
      open: this.session.open, capturing: this.capture.active, rows: sortRows(this.session.displayRows(), this.shopSort()),
      deal: freshDeal(this.session, Date.now()), hover: hoverText(h, this.engine), hoverKey: h?.key ?? null,
    }, this.engine.market, this.failedIcons, this.appraisal.overlayHtml()));
  }

  private drawSeen(src: HTMLCanvasElement): void {
    const c = $<HTMLCanvasElement>('seenCanvas'), ctx = c.getContext('2d');
    if (!ctx) return;
    const r = Math.min(160 / src.width, 120 / src.height);
    c.width = Math.max(1, Math.round(src.width * r)); c.height = Math.max(1, Math.round(src.height * r));
    ctx.drawImage(src, 0, 0, c.width, c.height);
    $('seenWrap').hidden = false;
  }

  /** Live capture health, so a broken share is obvious at a glance. */
  private renderDiag(): void {
    const el = $('diag');
    if (!this.capture.active) { el.hidden = true; return; }
    const { surface, size } = this.capture.describe();
    const idle = this.capture.latestAt ? Math.round((Date.now() - this.capture.latestAt) / 1000) : null;
    el.hidden = false;
    el.textContent = `sharing ${surface === 'monitor' ? 'whole screen' : surface} ${size} · ${this.capture.framesIn} frames received`
      + (idle != null && idle > 5 ? ` · none new for ${idle}s (normal while the screen is still)` : '')
      + ` · text reader ${this.reader.ready ? 'ready' : 'loading'}`
      + ` · area ${this.auto() ? (this.scanner.found ? 'found automatically' : 'looking for a shop') : this.region ? 'marked by you' : 'not set'}`;
  }

  // ---------- controls ----------

  private wire(): void {
    $('btnStart').addEventListener('click', () => void this.startCapture());
    $('btnStop').addEventListener('click', () => this.stopCapture());
    $('btnArea').addEventListener('click', () => void this.calibration.open());
    $('btnPip').addEventListener('click', () => void this.openOverlay());
    const sound = $<HTMLInputElement>('optSound');
    sound.checked = !!this.settings.sound;
    sound.addEventListener('change', () => {
      this.settings.sound = sound.checked;
      this.store.saveSettings(this.settings);
      if (sound.checked) { this.chime.unlock(); this.chime.play(); }
    });
    this.onFile('fileShot', (f) => this.loadScreenshot(f));
    $('btnClearDeals').addEventListener('click', () => { this.session.clearDeals(); this.render(); });

    // the open shop: click a column to order by it, again to flip; the choice is kept for the next shop
    for (const th of document.querySelectorAll<HTMLElement>('#shopTable th.sortable')) {
      const pick = () => this.setShopSort(nextSort(this.shopSort(), th.dataset.col as ShopSort['col']));
      th.addEventListener('click', pick);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    $('shopSortReset').addEventListener('click', () => this.setShopSort({ col: 'best', dir: 1 }));

    // price book
    $('bookSearch').addEventListener('input', () => this.renderBook());
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      th.addEventListener('click', () => {
        const col = th.dataset.col as BookSort['col'];
        this.sort = { col, dir: this.sort.col === col ? (-this.sort.dir as 1 | -1) : col === 'name' ? 1 : -1 };
        this.renderBook();
      });
    }
    $('bookTable').addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('cellinput')) return;
      const key = t.dataset.key!, field = t.dataset.field as 'manualRef' | 'buyUnder';
      let it = this.engine.book.items[key];
      if (!it) {
        const mk = this.engine.market.get(key);
        if (!mk) return;
        it = this.engine.book.items[key] = newItem(mk.n);
      }
      it[field] = t.value.trim() === '' ? null : parseAmount(t.value);
      this.saveBook(); this.reevaluate(); t.blur(); this.render();
    });
    $('bookTable').addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).dataset?.del;
      if (!k) return;
      delete this.engine.book.items[k];
      this.saveBook(); this.render();
    });

    // rules
    for (const [id, key] of Object.entries(SETTING_INPUTS)) {
      const el = $<HTMLInputElement | HTMLSelectElement>(id);
      el.value = String(this.settings[key]);
      el.addEventListener('change', () => {
        const v = el instanceof HTMLSelectElement ? el.value : parseFloat(el.value);
        if (typeof v === 'number' && !Number.isFinite(v)) { el.value = String(this.settings[key]); return; }
        (this.settings as unknown as Record<string, unknown>)[key] = v;
        this.store.saveSettings(this.settings);
        if (key === 'interval' && this.capture.active) this.ticker.start(Math.max(400, Math.round(this.settings.interval * 1000)));
        if (key === 'area') { this.scanner.reset(); void this.scan(true); }
        this.reevaluate(); this.render();
      });
    }

    // your prices
    $('btnPaste').addEventListener('click', () => {
      const box = $<HTMLTextAreaElement>('pasteBox');
      const { ok, bad } = parsePriceLines(box.value);
      for (const { name, value } of ok) {
        const key = resolveKey({ market: this.engine.market, book: this.engine.book }, name, false);
        const mk = this.engine.market.get(key);
        const it = this.engine.book.items[key] ?? (this.engine.book.items[key] = newItem(mk ? mk.n : name));
        it.manualRef = value;
      }
      this.saveBook(); this.reevaluate(); this.render();
      $('pasteMsg').textContent = `Added ${ok.length} price${ok.length === 1 ? '' : 's'}.`
        + (bad.length ? ` Couldn't read ${bad.length} line${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 2).join(' / ')}` : '');
      if (!bad.length) box.value = '';
    });

    // backup
    $('btnExport').addEventListener('click', () => {
      const body = JSON.stringify({ version: 1, exported: new Date().toISOString(), db: this.engine.book, settings: this.settings, region: this.region, appraisal: this.appraisal.entries() }, null, 1);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      a.download = `fm-deal-scanner-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('dataMsg').textContent = 'Exported.';
    });
    this.onFile('fileImport', async (f) => {
      try {
        const j = JSON.parse(await f.text()) as { db?: unknown; region?: Region | null; settings?: Partial<Settings>; appraisal?: unknown };
        if (!isPriceBook(j.db)) throw new Error('not a scanner backup');
        const n = mergeBackup(this.engine.book, j.db as PriceBook);
        if (j.region) { this.region = j.region; this.store.saveRegion(j.region); }
        this.tidyBook();
        this.saveBook(); this.reevaluate();
        const lines = this.appraisal.importEntries(cleanEntries(j.appraisal));
        this.render();
        $('dataMsg').textContent = `Imported ${n} item${n === 1 ? '' : 's'}.` + (lines ? ` Added ${lines} appraisal line${lines === 1 ? '' : 's'}.` : '');
      } catch { $('dataMsg').textContent = 'That file is not a scanner backup.'; }
    });
    this.onFile('fileMarket', async (f) => {
      try {
        const m = parseTrackerPage(await f.text(), f.lastModified || Date.now());
        if (!m.items.length) throw new Error('no price table');
        const kept = this.setMarket(m);
        const tidy = this.tidyBook();
        this.reevaluate(); this.render();
        $('marketMsg').textContent = `Loaded ${fmt(this.engine.market.priced)} market prices${m.world ? ` for ${m.world}` : ''}.` + (this.engine.market.withNpc ? ` ${fmt(this.engine.market.withNpc)} have an NPC shop price.` : '')
          + (tidy ? ` ${tidy}` : '') + (kept ? '' : ' The browser had no room to keep them, so load the file again next time.');
      } catch {
        $('marketMsg').textContent = "That page has no price table. On meso.watch, wait until your world's prices show, save the page as Webpage, Complete, and pick that .html file.";
      }
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
      this.saveBook(); this.render();
      $('dataMsg').textContent = 'Sightings cleared. Your typed prices stay.';
    });
  }

  private onFile(id: string, handle: (f: File) => Promise<void>): void {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { await handle(f); } finally { input.value = ''; }
    });
  }

  private async openOverlay(): Promise<void> {
    if (!Overlay.supported()) { $('btnPip').textContent = 'Overlay needs Chrome 116+'; return; }
    try {
      await this.overlay.open((img) => this.iconFailed(img), (act) => { if (act === 'scan') this.appraisal.toggleScanning(); });
      this.renderOverlay();
    } catch (e) { console.warn(e); }
  }
}
