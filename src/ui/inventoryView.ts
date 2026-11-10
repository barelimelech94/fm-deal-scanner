import { appraise, needsCount, type AppraisalResult } from '../appraisal/appraise';
import { addEntry, clampQty, entryFor, parseAppraisalLines } from '../appraisal/entries';
import { HoverCollector, type HoverEvent } from '../appraisal/hovers';
import { offerText, storePricesText } from '../appraisal/quote';
import type { Engine } from '../engine';
import { parseAmount } from '../lib/text';
import type { AppraisalData, AppraisalEntry, Region } from '../lib/types';
import { settingOf } from '../settings/schema';
import type { Storage } from '../store/storage';
import { $ } from './dom';
import {
  inventoryMeta, inventoryRowsHtml, inventorySteps, inventoryTotals, offerAsk, overlayInventoryHtml, shownLines,
} from './inventoryHtml';
import { DrawGate, setHidden, setHtml, setText } from './render';
import { SetupSteps } from './setupSteps';

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
  capturing(): boolean;
  /** the Get started steps' buttons */
  openPrices(): void;
  startCapture(): void;
  /** your items changed here: the overlay, which shows them too, follows */
  overlay(): void;
}

const CLEAR_LABEL = 'Clear';

/**
 * The Inventory view: your items, added by hovering them or by name, what they are worth, what to list each at in
 * your store, and an offer for everything at once.
 */
export class InventoryView {
  private data: AppraisalData;
  readonly collector: HoverCollector;
  private clearArmed = 0;
  private hint = '';
  private hintWarn = false;
  /** the line the last hover added to, counted again or fixed: highlighted */
  private lastId: string | null = null;
  /** show only the stacks that still need a count */
  private onlyNeedCount = false;
  /** a hover just came in: its row is scrolled into view on the next draw */
  private reveal = false;
  /** rises with every change made here: a line edited, added or removed, the filter, the hint */
  private edits = 0;
  private readonly gate = new DrawGate();
  private steps: SetupSteps | null = null;

  constructor(private readonly d: InventoryDeps) {
    this.data = d.store.loadAppraisal();
    this.collector = new HoverCollector(d.engine, this.data);
  }

  private get settings() { return this.d.engine.settings; }

  get scanning(): boolean { return this.collector.scanning; }

  /** Your items priced, in the order they were added. */
  result(): AppraisalResult {
    return appraise(this.d.engine, this.data.entries, this.settings.appraisalMode, this.settings.bulkOffer);
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

  /** What the pop-out overlay shows of your items. */
  overlayHtml(): string { return overlayInventoryHtml(this.result(), this.scanning, this.hint); }

  private save(): void { this.edits++; this.d.store.saveAppraisal(this.data); }
  private find(id: string | undefined) { return this.data.entries.find((x) => x.id === id); }

  setHint(text: string, warn = false): void { this.hint = text; this.hintWarn = warn; this.edits++; }

  /** Turns scanning on or off. Returns whether it is on: it can't start with nothing to scan. */
  setScanning(on: boolean): boolean {
    if (this.d.setScanning(on) === on) return on;
    this.setHint('Start the screen capture first (or load a screenshot in Settings), then press Scan my items.', true);
    this.render();
    return false;
  }

  toggleScanning(): void { this.setScanning(!this.scanning); }

  /** Scanning was turned on or off, here or elsewhere: the hint says what that means. */
  scanningChanged(): void {
    this.setHint(this.scanning ? "Scanning. Point at an item in the game: it is added a moment after its tooltip shows. Pause before moving over things you don't want counted." : '');
    this.render();
  }

  /** A hover was read: say what it did, and show its line, highlighted. */
  showEvent(ev: HoverEvent): void {
    if (ev.kind === 'added' || ev.kind === 'fixed' || ev.kind === 'undone') this.save();
    if (ev.entryId) { this.lastId = ev.entryId; this.reveal = true; }
    if (ev.kind === 'undone' && !this.find(this.lastId ?? undefined)) this.lastId = null;
    this.setHint(ev.text, !!ev.warn);
    this.render({ overTyping: true });
  }

  /** A line changed here: kept, drawn, and shown in the overlay. */
  private changed(): void {
    this.save();
    this.render({ overTyping: true });
    this.d.overlay();
  }

  /** What a Count or List at box says, put on its line. Returns whether the box belongs to a line. */
  private commit(t: HTMLInputElement): boolean {
    const entry = this.find(t.dataset.id);
    if (!entry) return false;
    if (t.dataset.field === 'qty') {
      entry.qty = clampQty(parseInt(t.value.replace(/,/g, ''), 10));
      entry.counted = true;
      this.collector.confirm(entry.id);
    } else if (t.value.trim() === '') delete entry.price;
    else {
      // the box shows the List at price; a price typed there is the line's own, unless it is the one already shown
      const v = parseAmount(t.value);
      if (v && v !== Number(t.defaultValue.replace(/,/g, ''))) entry.price = v;
    }
    return true;
  }

  wire(): void {
    this.steps = new SetupSteps($('invSetup'), $('invSteps'));
    $('apScan').addEventListener('click', () => this.toggleScanning());
    $('apUndo').addEventListener('click', () => {
      const ev = this.collector.undo();
      if (ev) this.showEvent(ev);
      this.d.overlay();
    });
    $('apNeedCount').addEventListener('click', () => { this.onlyNeedCount = !this.onlyNeedCount; this.edits++; this.render(); });
    $('apAddOpen').addEventListener('click', () => {
      $<HTMLDetailsElement>('apAddBox').open = true;
      $('apAdd').focus();
    });

    const table = $('apTable');
    table.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('cellinput') || !this.commit(t)) return;
      t.blur();
      this.changed();
    });
    // Enter in a Count box puts the count on its line and moves to the next line's Count box
    table.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key !== 'Enter' || t.dataset?.field !== 'qty') return;
      e.preventDefault();
      const boxes = [...table.querySelectorAll<HTMLInputElement>('input[data-field="qty"]')];
      const next = boxes[boxes.indexOf(t) + 1]?.dataset.id;
      if (!this.commit(t)) return;
      this.changed();
      const box = next && table.querySelector<HTMLInputElement>(`input[data-field="qty"][data-id="${CSS.escape(next)}"]`);
      if (box) { box.focus(); box.select(); }
    });
    table.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      const entry = b && this.find(b.dataset.id);
      if (!b || !entry) return;
      if (b.dataset.act === 'skip') entry.ignored = !entry.ignored || undefined;
      else {
        this.data.entries = this.data.entries.filter((x) => x !== entry);
        if (this.lastId === entry.id) this.lastId = null;
      }
      this.changed();
    });

    $('apAddBtn').addEventListener('click', () => {
      const box = $<HTMLTextAreaElement>('apAdd');
      const { ok, bad } = parseAppraisalLines(box.value);
      for (const { name, qty } of ok) addEntry(this.data.entries, entryFor(this.d.engine, name, qty));
      this.changed();
      $('apMsg').textContent = ok.length || bad.length
        ? `Added ${ok.length} item${ok.length === 1 ? '' : 's'}.` + (bad.length ? ` Couldn't read ${bad.length} line${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 2).join(' / ')}` : '')
        : 'Type or paste item names first.';
      if (!bad.length) box.value = '';
    });

    $('apCopy').addEventListener('click', () => void this.copy(offerText(this.result()), 'Copied the offer.'));
    $('apCopyStore').addEventListener('click', () => void this.copy(storePricesText(this.result(), this.settings.storeAdjust), 'Copied the store prices.'));
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
      this.lastId = null;
      this.onlyNeedCount = false;
      this.clearArmed = 0; clear.textContent = CLEAR_LABEL;
      this.changed();
      $('apMsg').textContent = 'Cleared.';
    });
  }

  /** The clipboard, where the browser allows it. */
  private async copy(text: string, done: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); $('apMsg').textContent = done; }
    catch { $('apMsg').textContent = "Couldn't copy: this browser didn't allow it."; }
  }

  /**
   * Draws the view while it is shown, when your items, the hovers or the prices changed since it last drew.
   * `force` draws anyway (it was just shown); `overTyping` draws the table even with a box in it focused (a hover
   * or a change made in the table). Only what differs is written.
   */
  render(o: { force?: boolean; overTyping?: boolean } = {}): void {
    if (!this.d.shown()) return;
    const setup = { prices: this.d.engine.market.priced, capturing: this.d.capturing(), items: this.data.entries.length };
    const key = `${this.collector.version}|${this.edits}|${this.d.version()}|${JSON.stringify(setup)}`;
    if (!this.gate.due(key, o.force)) return;
    this.steps?.render(inventorySteps(setup, { openPrices: () => this.d.openPrices(), startCapture: () => this.d.startCapture() }));
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#apTable');
    const r = this.result(), on = this.scanning, adjust = this.settings.storeAdjust;
    const scan = $<HTMLButtonElement>('apScan');
    setText(scan, on ? 'Pause' : 'Scan my items');
    scan.classList.toggle('primary', !on);
    scan.setAttribute('aria-pressed', String(on));
    $<HTMLButtonElement>('apUndo').disabled = !this.collector.canUndo;
    setText($('apHint'), this.hint);
    setHidden($('apHint'), !this.hint);
    $('apHint').classList.toggle('bad', this.hintWarn);
    setText($('apModeNote'), settingOf('appraisalMode').help);
    // typing in a box: leave the table alone until the change is made
    if (typing && !o.overTyping) { this.gate.reset(); return; }

    // the filter goes off once every stack has its count
    if (!r.lines.some(needsCount)) this.onlyNeedCount = false;
    const meta = inventoryMeta(r);
    setText($('apMeta'), meta.items);
    setHidden($('apNeedWrap'), meta.need == null);
    const need = $('apNeedCount');
    setText(need, meta.need ?? '');
    need.setAttribute('aria-pressed', String(this.onlyNeedCount));
    need.title = this.onlyNeedCount ? 'Show all items' : 'Show only the items that need a count';
    setText($('apNoPrice'), meta.noPrice);
    setHidden($('apNoPrice'), !meta.noPrice);

    const t = inventoryTotals(r, adjust), lines = shownLines(r, this.onlyNeedCount);
    setText($('apTotal'), t.worth);
    setText($('apStore'), t.store);
    setText($('apLeft'), t.left);
    const body = $('apBody');
    setHtml(body, inventoryRowsHtml(lines, this.d.engine.market, { storeAdjust: adjust, lastId: this.lastId, failed: this.d.failed }));
    setHidden($('apEmpty'), lines.length > 0);
    setHidden($('apTable'), !lines.length);
    if (this.reveal) {
      this.reveal = false;
      body.querySelector('tr.last')?.scrollIntoView({ block: 'nearest' });
    }
    setText($('apOffer'), offerAsk(r));
    setText($('apQuote'), offerText(r));
    $<HTMLButtonElement>('apCopy').disabled = !r.kinds;
    $<HTMLButtonElement>('apCopyStore').disabled = !r.kinds;
    $<HTMLButtonElement>('apClear').disabled = !this.data.entries.length;
  }
}
