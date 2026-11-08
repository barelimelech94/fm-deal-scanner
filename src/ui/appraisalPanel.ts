import { APPRAISAL_MODES, appraise, AS_ADDED, cleanAppraisalSort, nextAppraisalSort, sortLines, type AppraisalResult, type AppraisalSort } from '../appraisal/appraise';
import { addEntry, clampQty, entryFor, parseAppraisalLines } from '../appraisal/entries';
import { HoverCollector, type HoverEvent } from '../appraisal/hovers';
import { quoteFull, quoteShort } from '../appraisal/quote';
import type { Engine } from '../engine';
import { parseAmount } from '../lib/text';
import { DEFAULT_SETTINGS, type AppraisalData, type AppraisalEntry, type AppraisalMode, type AppraisalSortCol, type Region } from '../lib/types';
import type { Storage } from '../store/storage';
import { appraisalRowsHtml, appraisalText, overlayAppraisalHtml } from './appraisalViews';
import { $ } from './dom';

export interface PanelDeps {
  engine: Engine;
  store: Storage;
  failed: ReadonlySet<string>;
  /** the area marked for items, if any */
  region(): Region | null;
  /** a screen share or a screenshot is there to scan */
  canScan(): boolean;
  /** open the dialog that marks the area */
  onMark(): void;
  /** scanning was turned on or off */
  onScan(on: boolean): void;
}

const CLEAR_LABEL = 'Clear';

/** The appraisal panel: the list you build by hand or by hovering items, what it is worth, and the quote. */
export class AppraisalPanel {
  private data: AppraisalData;
  readonly collector: HoverCollector;
  private clearArmed = 0;
  private hint = '';
  private hintWarn = false;

  constructor(private readonly d: PanelDeps) {
    this.data = d.store.loadAppraisal();
    this.collector = new HoverCollector(d.engine, this.data);
    // settings saved by hand or by another version can hold anything: fall back to the defaults
    const s = d.engine.settings;
    if (!(s.appraisalMode in APPRAISAL_MODES)) s.appraisalMode = DEFAULT_SETTINGS.appraisalMode;
    if (!(s.bulkOffer > 0)) s.bulkOffer = DEFAULT_SETTINGS.bulkOffer;
    if (s.appraisalArea !== 'any' && s.appraisalArea !== 'marked') s.appraisalArea = DEFAULT_SETTINGS.appraisalArea;
    const o = cleanAppraisalSort(s.appraisalSort, s.appraisalSortDir);
    s.appraisalSort = o.col; s.appraisalSortDir = o.dir;
  }

  private get settings() { return this.d.engine.settings; }

  get scanning(): boolean { return this.collector.scanning; }

  /** How the lines are ordered: the saved choice. */
  sort(): AppraisalSort { return cleanAppraisalSort(this.settings.appraisalSort, this.settings.appraisalSortDir); }

  private setSort(s: AppraisalSort): void {
    this.settings.appraisalSort = s.col;
    this.settings.appraisalSortDir = s.dir;
    this.d.store.saveSettings(this.settings);
    this.render(true);
  }

  /** The appraisal, its lines in the order chosen: the table and the copied list follow it. */
  result(): AppraisalResult {
    const r = appraise(this.d.engine, this.data.entries, this.settings.appraisalMode, this.settings.bulkOffer);
    r.lines = sortLines(r.lines, this.sort());
    return r;
  }

  /** Where hovers count: near the marked area, or anywhere (also while no area is marked). */
  area(): Region | null { return this.settings.appraisalArea === 'marked' ? this.d.region() : null; }

  /** The lines, for a backup. */
  entries(): AppraisalEntry[] { return this.data.entries; }

  /** Adds the lines of a backup. A line already here (same id) is skipped, so importing a file twice doesn't double it. Returns how many were added; the caller redraws. */
  importEntries(list: readonly AppraisalEntry[]): number {
    let n = 0;
    for (const x of list) {
      if (this.find(x.id)) continue;
      addEntry(this.data.entries, { ...x });
      n++;
    }
    if (n) this.save();
    return n;
  }

  /** What the pop-out overlay shows of the appraisal. */
  overlayHtml(): string { return overlayAppraisalHtml(this.result(), this.scanning, this.hint); }

  private save(): void { this.d.store.saveAppraisal(this.data); }
  private find(id: string | undefined) { return this.data.entries.find((x) => x.id === id); }

  setHint(text: string, warn = false): void { this.hint = text; this.hintWarn = warn; }

  /** Turns scanning on or off. Returns whether it is on: it can't start with nothing to scan. */
  setScanning(on: boolean): boolean {
    if (on && !this.d.canScan()) {
      this.setHint('Start the screen capture first (or load a screenshot), then press Start scanning.', true);
      this.render();
      return false;
    }
    if (this.collector.scanning === on) return on;
    this.collector.scanning = on;
    this.collector.noTooltip();
    this.setHint(on ? 'Scanning. Point at an item in the game: it is added a moment after the tooltip appears. Pause before moving over things you don\'t want counted.' : '');
    this.render();
    this.d.onScan(on);
    return on;
  }

  toggleScanning(): void { this.setScanning(!this.scanning); }

  /** A hover was read: say what it did, and show the new line. */
  showEvent(ev: HoverEvent): void {
    if (ev.kind === 'added' || ev.kind === 'fixed' || ev.kind === 'undone') this.save();
    this.setHint(ev.text, !!ev.warn);
    this.render(true);
  }

  wire(): void {
    const mode = $<HTMLSelectElement>('apMode'), bulk = $<HTMLInputElement>('apBulk'), area = $<HTMLSelectElement>('apArea');
    mode.value = this.settings.appraisalMode;
    bulk.value = String(this.settings.bulkOffer);
    area.value = this.settings.appraisalArea;
    mode.addEventListener('change', () => {
      this.settings.appraisalMode = mode.value as AppraisalMode;
      this.d.store.saveSettings(this.settings);
      this.render();
    });
    bulk.addEventListener('change', () => {
      const v = parseFloat(bulk.value);
      if (Number.isFinite(v) && v > 0) this.settings.bulkOffer = Math.min(300, Math.round(v * 10) / 10);
      bulk.value = String(this.settings.bulkOffer);
      this.d.store.saveSettings(this.settings);
      this.render();
    });
    area.addEventListener('change', () => {
      this.settings.appraisalArea = area.value === 'marked' ? 'marked' : 'any';
      this.d.store.saveSettings(this.settings);
      this.setHint(this.settings.appraisalArea === 'marked' && !this.d.region() ? 'Press Mark area to draw the box around your item slots.' : '');
      this.render();
    });
    // order the lines: a click on a column (again to flip), the Order list, or back to the order they were added in
    for (const th of document.querySelectorAll<HTMLElement>('#apTable th.sortable')) {
      const pick = () => this.setSort(nextAppraisalSort(this.sort(), th.dataset.col as AppraisalSortCol));
      th.addEventListener('click', pick);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    const order = $<HTMLSelectElement>('apOrder');
    order.addEventListener('change', () => {
      const [col, dir] = order.value.split(':');
      this.setSort(cleanAppraisalSort(col, Number(dir)));
    });
    $('apSortReset').addEventListener('click', () => this.setSort(AS_ADDED));
    $('apScan').addEventListener('click', () => this.toggleScanning());
    $('apMark').addEventListener('click', () => this.d.onMark());
    $('apUndo').addEventListener('click', () => {
      const ev = this.collector.undo();
      if (ev) this.showEvent(ev);
    });

    const table = $('apTable');
    table.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('cellinput')) return;
      const entry = this.find(t.dataset.id);
      if (!entry) return;
      if (t.dataset.field === 'qty') { entry.qty = clampQty(parseInt(t.value.replace(/,/g, ''), 10)); this.collector.confirm(entry.id); }
      else if (t.value.trim() === '') delete entry.price;
      else { const v = parseAmount(t.value); if (v) entry.price = v; }
      this.save(); t.blur(); this.render();
    });
    table.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      const entry = b && this.find(b.dataset.id);
      if (!b || !entry) return;
      if (b.dataset.act === 'skip') entry.ignored = !entry.ignored || undefined;
      else this.data.entries = this.data.entries.filter((x) => x !== entry);
      this.save(); this.render();
    });

    $('apAddBtn').addEventListener('click', () => {
      const box = $<HTMLTextAreaElement>('apAdd');
      const { ok, bad } = parseAppraisalLines(box.value);
      for (const { name, qty } of ok) addEntry(this.data.entries, entryFor(this.d.engine, name, qty));
      this.save(); this.render();
      $('apMsg').textContent = ok.length || bad.length
        ? `Added ${ok.length} item${ok.length === 1 ? '' : 's'}.` + (bad.length ? ` Couldn't read ${bad.length} line${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 2).join(' / ')}` : '')
        : 'Type or paste item names first.';
      if (!bad.length) box.value = '';
    });

    $('apCopy').addEventListener('click', () => void this.copy(quoteShort(this.result())));
    $('apCopyFull').addEventListener('click', () => void this.copy(quoteFull(this.result())));
    const clear = $('apClear');
    clear.addEventListener('click', () => {
      if (!this.data.entries.length) return;
      if (Date.now() - this.clearArmed > 4000) {
        this.clearArmed = Date.now();
        clear.textContent = 'Click again to clear';
        setTimeout(() => { clear.textContent = CLEAR_LABEL; }, 4000);
        return;
      }
      this.data.entries = [];
      this.collector.forget();
      this.clearArmed = 0; clear.textContent = CLEAR_LABEL;
      this.save(); this.render();
      $('apMsg').textContent = 'Cleared.';
    });
  }

  /** The clipboard, where the browser allows it; the quote line stays on screen to copy by hand. */
  private async copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); $('apMsg').textContent = 'Copied.'; }
    catch { $('apMsg').textContent = "Couldn't copy. Select the quote text and copy it."; }
  }

  /** `force` draws the table even with a box focused: a hover just changed it. */
  render(force = false): void {
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#apTable');
    const r = this.result(), t = appraisalText(r), on = this.scanning;
    const scan = $<HTMLButtonElement>('apScan');
    scan.textContent = on ? 'Pause scanning' : 'Start scanning hovers';
    scan.classList.toggle('primary', !on);
    scan.setAttribute('aria-pressed', String(on));
    $('apState').textContent = on ? 'Scanning: point at your items' : 'Paused';
    $('apState').dataset.on = String(on);
    $<HTMLSelectElement>('apArea').value = this.settings.appraisalArea;
    $<HTMLButtonElement>('apMark').disabled = !this.d.canScan();
    $<HTMLButtonElement>('apUndo').disabled = !this.collector.canUndo;
    $('apHint').textContent = this.hint;
    $('apHint').hidden = !this.hint;
    $('apHint').classList.toggle('bad', this.hintWarn);
    // the order: arrows on the headers, the Order list, and the way back
    const s = this.sort();
    for (const th of document.querySelectorAll<HTMLElement>('#apTable th.sortable')) {
      const on = th.dataset.col === s.col;
      th.innerHTML = (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${s.dir > 0 ? '▲' : '▼'}</span>` : '');
      th.setAttribute('aria-sort', on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    const order = $<HTMLSelectElement>('apOrder'), key = s.col === 'added' ? 'added' : `${s.col}:${s.dir}`;
    order.value = [...order.options].some((o) => o.value === key) ? key : 'custom';
    $('apSortReset').hidden = s.col === 'added';
    // typing in a box: leave the table alone until the change is made
    if (typing && !force) return;
    $('apMeta').textContent = t.meta;
    $('apBody').innerHTML = appraisalRowsHtml(r, this.d.engine.market, this.d.failed);
    $('apEmpty').hidden = r.lines.length > 0;
    $('apTable').hidden = !r.lines.length;
    $('apTotal').textContent = t.total;
    $('apRough').textContent = t.rough;
    $('apWarn').textContent = t.warn;
    $('apWarn').hidden = !t.warn;
    $('apOfferLabel').textContent = t.offerLabel;
    $('apOffer').textContent = t.offer;
    $('apModeNote').textContent = t.mode;
    $('apQuote').textContent = quoteShort(r);
    for (const id of ['apCopy', 'apCopyFull']) $<HTMLButtonElement>(id).disabled = !r.kinds;
    $<HTMLButtonElement>('apClear').disabled = !this.data.entries.length;
  }
}
