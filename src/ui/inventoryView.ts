import { appraise, AS_ADDED, cleanAppraisalSort, nextAppraisalSort, sortLines, type AppraisalResult, type AppraisalSort } from '../appraisal/appraise';
import { addEntry, clampQty, entryFor, parseAppraisalLines } from '../appraisal/entries';
import { HoverCollector, type HoverEvent } from '../appraisal/hovers';
import { quoteFull, quoteShort } from '../appraisal/quote';
import type { Engine } from '../engine';
import { parseAmount } from '../lib/text';
import type { AppraisalData, AppraisalEntry, AppraisalSortCol, Region } from '../lib/types';
import type { Storage } from '../store/storage';
import { appraisalRowsHtml, appraisalText, overlayAppraisalHtml } from './appraisalViews';
import { $ } from './dom';
import { DrawGate, setHidden, setHtml, setText } from './render';

export interface InventoryDeps {
  engine: Engine;
  store: Storage;
  failed: ReadonlySet<string>;
  /** the area marked for items, if any */
  region(): Region | null;
  /** turns scanning your items on or off; false when it can't start, with nothing to scan */
  setScanning(on: boolean): boolean;
  /** whether the view is the one shown */
  shown(): boolean;
  /** changes when anything that prices items changed: settings, market prices, your prices */
  version(): string;
}

const CLEAR_LABEL = 'Clear';

/** The Inventory view: your items, added by hand or by hovering them, what they are worth, and the quote. */
export class InventoryView {
  private data: AppraisalData;
  readonly collector: HoverCollector;
  private clearArmed = 0;
  private hint = '';
  private hintWarn = false;
  /** rises with every change made here: a line edited, added or removed, the order, the hint */
  private edits = 0;
  private readonly gate = new DrawGate();

  constructor(private readonly d: InventoryDeps) {
    this.data = d.store.loadAppraisal();
    this.collector = new HoverCollector(d.engine, this.data);
  }

  private get settings() { return this.d.engine.settings; }

  get scanning(): boolean { return this.collector.scanning; }

  /** How the lines are ordered: the saved choice. */
  sort(): AppraisalSort { return cleanAppraisalSort(this.settings.appraisalSort, this.settings.appraisalSortDir); }

  private setSort(s: AppraisalSort): void {
    this.settings.appraisalSort = s.col;
    this.settings.appraisalSortDir = s.dir;
    this.d.store.saveSettings(this.settings);
    this.edits++;
    this.render({ overTyping: true });
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

  private save(): void { this.edits++; this.d.store.saveAppraisal(this.data); }
  private find(id: string | undefined) { return this.data.entries.find((x) => x.id === id); }

  setHint(text: string, warn = false): void { this.hint = text; this.hintWarn = warn; this.edits++; }

  /** Turns scanning on or off. Returns whether it is on: it can't start with nothing to scan. */
  setScanning(on: boolean): boolean {
    if (this.d.setScanning(on) === on) return on;
    this.setHint('Start the screen capture first (or load a screenshot), then press Start scanning.', true);
    this.render();
    return false;
  }

  toggleScanning(): void { this.setScanning(!this.scanning); }

  /** Scanning was turned on or off, here or elsewhere: the hint says what that means. */
  scanningChanged(): void {
    this.setHint(this.scanning ? 'Scanning. Point at an item in the game: it is added a moment after the tooltip appears. Pause before moving over things you don\'t want counted.' : '');
    this.render();
  }

  /** A hover was read: say what it did, and show the new line. */
  showEvent(ev: HoverEvent): void {
    if (ev.kind === 'added' || ev.kind === 'fixed' || ev.kind === 'undone') this.save();
    this.setHint(ev.text, !!ev.warn);
    this.render({ overTyping: true });
  }

  wire(): void {
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

  /**
   * Draws the view while it is shown, when your items, the hovers or the prices changed since it last drew.
   * `force` draws anyway (it was just shown); `overTyping` draws the table even with a box in it focused (a hover
   * or a new order just changed it). Only what differs is written.
   */
  render(o: { force?: boolean; overTyping?: boolean } = {}): void {
    if (!this.d.shown() || !this.gate.due(`${this.collector.version}|${this.edits}|${this.d.version()}`, o.force)) return;
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#apTable');
    const r = this.result(), t = appraisalText(r), on = this.scanning;
    const scan = $<HTMLButtonElement>('apScan');
    setText(scan, on ? 'Pause scanning' : 'Start scanning hovers');
    scan.classList.toggle('primary', !on);
    scan.setAttribute('aria-pressed', String(on));
    setText($('apState'), on ? 'Scanning: point at your items' : 'Paused');
    $('apState').dataset.on = String(on);
    $<HTMLButtonElement>('apUndo').disabled = !this.collector.canUndo;
    setText($('apHint'), this.hint);
    setHidden($('apHint'), !this.hint);
    $('apHint').classList.toggle('bad', this.hintWarn);
    // the order: arrows on the headers, the Order list, and the way back
    const s = this.sort();
    for (const th of document.querySelectorAll<HTMLElement>('#apTable th.sortable')) {
      const on = th.dataset.col === s.col;
      setHtml(th, (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${s.dir > 0 ? '▲' : '▼'}</span>` : ''));
      th.setAttribute('aria-sort', on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    const order = $<HTMLSelectElement>('apOrder'), key = s.col === 'added' ? 'added' : `${s.col}:${s.dir}`;
    order.value = [...order.options].some((o) => o.value === key) ? key : 'custom';
    setHidden($('apSortReset'), s.col === 'added');
    // typing in a box: leave the table alone until the change is made
    if (typing && !o.overTyping) { this.gate.reset(); return; }
    setText($('apMeta'), t.meta);
    setHtml($('apBody'), appraisalRowsHtml(r, this.d.engine.market, this.d.failed));
    setHidden($('apEmpty'), r.lines.length > 0);
    setHidden($('apTable'), !r.lines.length);
    setText($('apTotal'), t.total);
    setText($('apRough'), t.rough);
    setText($('apWarn'), t.warn);
    setHidden($('apWarn'), !t.warn);
    setText($('apOfferLabel'), t.offerLabel);
    setText($('apOffer'), t.offer);
    setText($('apModeNote'), t.mode);
    setText($('apQuote'), quoteShort(r));
    for (const id of ['apCopy', 'apCopyFull']) $<HTMLButtonElement>(id).disabled = !r.kinds;
    $<HTMLButtonElement>('apClear').disabled = !this.data.entries.length;
  }
}
