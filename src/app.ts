import { HoverScanner } from './appraisal/hoverScan';
import { ScreenCapture } from './capture/screen';
import { Ticker } from './capture/ticker';
import type { Engine } from './engine';
import type { HoverEvent } from './appraisal/hovers';
import type { MarketData, Region, Settings, ViewName } from './lib/types';
import { loadCatalog } from './market/catalog';
import { loadEquipFacts } from './market/equipFacts';
import { MarketIndex } from './market/marketIndex';
import { Reader } from './ocr/reader';
import { pruneOld } from './pricing/priceBook';
import { ScanController, type ScanChange } from './scan/controller';
import { Scanner } from './scan/scanner';
import { ShopSession, type Deal } from './shop/session';
import { SaveLater } from './store/saveLater';
import { Storage } from './store/storage';
import { Calibration, type AreaKind } from './ui/calibrate';
import { CaptureBar } from './ui/captureBar';
import { DataGroup } from './ui/dataGroup';
import { DealsView } from './ui/dealsView';
import { $ } from './ui/dom';
import { InventoryView } from './ui/inventoryView';
import { Overlay } from './ui/overlay';
import { PricesView, tidyBook } from './ui/pricesView';
import { SettingsBinder } from './ui/settingsBind';
import { captureDetails, SettingsView } from './ui/settingsView';
import { Shell } from './ui/shell';
import { Chime } from './ui/sound';
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
  private readonly overlay: Overlay;
  private readonly chime = new Chime();
  private readonly calibration: Calibration;
  private readonly shell: Shell;
  private readonly bar: CaptureBar;
  private readonly deals: DealsView;
  private readonly inventory: InventoryView;
  private readonly prices: PricesView;
  private readonly settingsView: SettingsView;
  private readonly dataGroup: DataGroup;
  private readonly binder: SettingsBinder;
  private region: Region | null;
  /** the area marked for your items' hovers */
  private itemsRegion: Region | null;
  /** icon addresses that failed to load: show the emoji instead from now on */
  private readonly failedIcons = new Set<string>();
  /** rises when anything that prices items changes: a setting, the market prices, your prices, the item pictures */
  private data = 0;
  /** the price book is saved a second after its last change */
  private readonly bookSave: SaveLater;

  constructor() {
    const book = this.store.loadBook();
    this.engine = { market: new MarketIndex(this.store.loadMarket()), facts: new Map(), book, settings: this.store.loadSettings(), now: () => Date.now() };
    pruneOld(book, Date.now());
    this.region = this.store.loadRegion();
    this.itemsRegion = this.store.loadItemsRegion();
    const e = this.engine, failed = this.failedIcons;
    this.bookSave = new SaveLater(() => this.store.saveBook(this.engine.book));
    const shown = (v: ViewName) => () => this.shell.isShown(v);

    this.session = new ShopSession(e, { onDeal: (d) => this.onDeal(d) });
    this.scanner = new Scanner(canvasAdapter, this.reader, this.session, e, { onBook: () => this.saveBook() });
    this.inventory = new InventoryView({
      engine: e, store: this.store, failed, region: () => this.itemsRegion, setScanning: (on) => this.setScanning(on),
      shown: shown('inventory'), version: () => String(this.data), capturing: () => this.capture.active,
      openPrices: () => this.shell.show('prices'), startCapture: () => this.startCapture(), overlay: () => this.overlay.render(),
    });
    this.controller = new ScanController({
      engine: e, capture: this.capture, reader: this.reader, repeat: (tick) => new Ticker(tick),
      session: this.session, shop: this.scanner,
      collector: this.inventory.collector, hovers: new HoverScanner(canvasAdapter, this.reader, this.inventory.collector, e),
      shopRegion: () => this.region, itemsArea: () => this.inventory.area(),
    });
    this.controller.on((c) => this.changed(c));

    const shopAndData = () => `${this.session.version}|${this.data}`;
    this.deals = new DealsView({
      engine: e, session: this.session, failed, saveSettings: () => this.saveSettings(), overlay: () => this.overlay.render(),
      shown: shown('deals'), version: shopAndData,
      capturing: () => this.capture.active, looking: () => this.capture.active && this.controller.mode === 'deals',
      openPrices: () => this.shell.show('prices'), startCapture: () => this.startCapture(), markShop: () => void this.calibration.open('shop'),
    });
    this.overlay = new Overlay({
      engine: e, session: this.session, failed, mode: () => this.controller.mode, capturing: () => this.capture.active,
      scanning: () => this.inventory.scanning, rows: () => this.deals.rows(), inventory: () => this.inventory.glance(),
      setMode: (m) => this.shell.followMode(m), toggleScanning: () => this.inventory.toggleScanning(), iconFailed: (img) => this.iconFailed(img),
    });
    this.prices = new PricesView({
      engine: e, failed, saveBook: () => this.saveBook(), setMarket: (m) => this.setMarket(m), changed: () => this.pricesChanged(),
      shown: shown('prices'), version: shopAndData,
    });
    this.settingsView = new SettingsView($('view-settings'), {
      canScan: () => this.controller.canScan,
      markShop: () => void this.calibration.open('shop'),
      markItems: () => void this.calibration.open('items'),
      loadShot: (f) => this.loadScreenshot(f),
      diag: () => this.diag(),
      seen: () => this.controller.seen,
      mode: () => this.controller.mode,
    });
    this.dataGroup = new DataGroup({
      engine: e, regions: () => ({ region: this.region, itemsRegion: this.itemsRegion }),
      entries: () => this.inventory.entries(), importEntries: (list) => this.inventory.importEntries(list),
      restore: (r) => this.restore(r), saveBook: () => this.saveBook(), changed: () => this.pricesChanged(),
    });
    this.binder = new SettingsBinder(e.settings, (key) => this.settingChanged(key));
    this.bar = new CaptureBar(this.controller, {
      start: () => this.startCapture(),
      stop: () => this.controller.stopCapture(),
      overlay: () => void this.overlay.open(),
      dismissError: () => this.controller.dismissError(),
    });
    this.shell = new Shell({
      settings: e.settings, save: () => this.saveSettings(), setMode: (m) => this.controller.setMode(m), shown: () => this.render(true),
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
    this.dataGroup.wire();
    this.binder.bind(document);
    const fixed = tidyBook(this.engine);
    if (fixed) { this.saveBook(); this.dataGroup.say(fixed); }
    this.shell.start();
    document.addEventListener('error', (e) => { const t = e.target as Element | null; if (t?.tagName === 'IMG') this.iconFailed(t as HTMLImageElement); }, true);
    // the price book waiting to be saved is saved before the page goes, or goes to the background
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.bookSave.flush();
      else document.title = 'FM Deal Scanner';
    });
    window.addEventListener('pagehide', () => this.bookSave.flush());
    // the banner's 5 minutes and the hovered item's 90 seconds run out even when nothing is read, and the
    // Prices view's "last seen" and the market prices' age move on
    setInterval(() => { if (!document.hidden) { this.deals.render(true); this.prices.render(true); this.overlay.render(); } }, 15_000);
    setInterval(() => { if (this.shell.isShown('settings')) this.settingsView.renderTrouble(); }, 1000);
    this.loadGameData();
  }

  /**
   * The game data served beside the page, each file as it arrives; a missing one changes nothing. Item ids by
   * name give items the tracker doesn't list (or all of them, with no tracker page loaded) their pictures. Every
   * equip's slots and base stats are what the stats read off a tooltip are measured against.
   */
  private loadGameData(): void {
    const base = import.meta.env.BASE_URL;
    void loadCatalog(`${base}items.json`).then((catalog) => {
      if (catalog.size) { this.engine.market = this.engine.market.withCatalog(catalog); this.data++; this.render(); }
    });
    void loadEquipFacts(`${base}equips.json`).then((facts) => {
      if (facts.size) { this.engine.facts = facts; this.pricesChanged(); }
    });
  }

  private get settings(): Settings { return this.engine.settings; }

  // ---------- what the scanning tells ----------

  private changed(c: ScanChange): void {
    if (c.kind === 'shop') { this.deals.render(); this.prices.render(); }
    else if (c.kind === 'hover') this.hoverChanged(c.event);
    else if (c.kind === 'status') { this.bar.render(); this.deals.render(); this.inventory.render(); if (this.shell.isShown('settings')) this.settingsView.render(); }
    else {
      document.body.dataset.scans = String(this.controller.scans);
      this.deals.render();   // it counts how long capture has looked for a shop
      if (this.shell.isShown('settings')) this.settingsView.renderTrouble();
      return;
    }
    this.overlay.render();
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

  private startCapture(): void {
    this.chime.unlock();
    void this.controller.startCapture();
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

  /** Something that prices items changed: the shop is judged again, and the view drawn. */
  private pricesChanged(): void {
    this.data++;
    this.session.reevaluate();
    this.render();
  }

  private saveBook(): void { this.bookSave.request(); }

  private setMarket(m: MarketData): boolean {
    this.engine.market = new MarketIndex(m, this.engine.market.catalog);
    return this.store.saveMarket(m);
  }

  /**
   * A backup's settings and marked areas, put in place. The view and the scan mode stay as they are: they are
   * where the person is now, not something to restore.
   */
  private restore(r: { settings?: Settings; region?: Region; itemsRegion?: Region }): void {
    if (r.region) { this.region = r.region; this.store.saveRegion(r.region); }
    if (r.itemsRegion) { this.itemsRegion = r.itemsRegion; this.store.saveItemsRegion(r.itemsRegion); }
    if (r.settings) {
      const { view, mode } = this.settings;
      Object.assign(this.settings, r.settings, { view, mode });
      this.saveSettings();
      this.binder.show();
      this.controller.restartTicker();
    }
    if (r.settings || r.region) this.controller.areaChanged();
  }

  // ---------- drawing ----------

  /** Draws the bar, the view shown (each view draws only while shown, when its data changed or `force`d) and the overlay. */
  render(force = false): void {
    this.bar.render();
    this.deals.render(force);
    this.inventory.render({ force });
    this.prices.render(force);
    if (this.shell.isShown('settings')) this.settingsView.render();
    this.overlay.render();
  }

  private iconFailed(img: HTMLImageElement): void {
    if (!img.closest('.ico')) return;
    this.failedIcons.add(img.getAttribute('src') ?? '');
    img.remove();
  }

  /** Live capture health, so a broken share is obvious at a glance. */
  private diag(): string {
    if (!this.capture.active) return '';
    const c = this.capture;
    return captureDetails({ ...c.describe(), framesIn: c.framesIn, idle: c.latestAt ? Date.now() - c.latestAt : null, reader: this.reader.ready, target: this.controller.readTarget() });
  }
}
