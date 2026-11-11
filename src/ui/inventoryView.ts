import { appraise, needsCount, type AppraisalResult } from '../appraisal/appraise';
import { addEntry, clampQty, entryFor, parseAppraisalLines } from '../appraisal/entries';
import { HoverCollector, type HoverEvent } from '../appraisal/hovers';
import { storePricesText } from '../appraisal/quote';
import type { Engine } from '../engine';
import { parseAmount } from '../lib/text';
import type { AppraisalData, AppraisalEntry, Region } from '../lib/types';
import type { Storage } from '../store/storage';
import { $ } from './dom';
import {
  inventoryGlance, inventoryMeta, inventoryRowsHtml, inventorySteps, inventoryTotals, scanLabel, shownLines,
} from './inventoryHtml';
import type { InventoryGlance } from './overlayHtml';
import { DrawGate, setHidden, setHtml, setText } from './render';
import { SetupSteps } from './setupSteps';

export interface InventoryDeps {
  engine: Engine;
  store: Storage;
  failed: ReadonlySet<string>;
  /** the area marked for items, if any */
  region(): Region | null;
  /** turns scanning your items on or off; on starts the screen capture first when nothing is shared */
  setScanning(on: boolean): void;
  /** you pressed Pause (not just "not scanning yet"): the button says Resume */
  paused(): boolean;
  /** whether the view is the one shown */
  shown(): boolean;
  /** changes when anything that prices items changed: settings, market prices, your prices */
  version(): string;
  capturing(): boolean;
  /** the Get started step's button */
  openPrices(): void;
  /** your items changed here: the overlay, which shows them too, follows */
  overlay(): void;
}

const CLEAR_LABEL = 'Clear', CLEAR_ASK = 'Click again to clear';

/**
 * The Inventory view: your items, added by hovering them or by name, what they are worth, what to list each at in
 * your store.
 */
export class InventoryView {
  private data: AppraisalData;
  readonly collector: HoverCollector;
  private clearArmed = 0;
  private hint = '';
  private hintWarn = false;
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
    return appraise(this.d.engine, this.data.entries, this.settings.appraisalMode);
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
  glance(): InventoryGlance {
    return inventoryGlance(this.result(), { lastId: this.collector.lastId, storeAdjust: this.settings.storeAdjust, market: this.d.engine.market, hint: this.hint });
  }

  private save(): void { this.edits++; this.d.store.saveAppraisal(this.data); }
  private find(id: string | undefined) { return this.data.entries.find((x) => x.id === id); }

  setHint(text: string, warn = false): void { this.hint = text; this.hintWarn = warn; this.edits++; }

  /** Scan my items, Pause or Resume: on starts the screen capture first when nothing is shared. */
  toggleScanning(): void { this.d.setScanning(!this.scanning); }

  /** Scanning was turned on or off, here or elsewhere: the hint says what that means. */
  scanningChanged(): void {
    this.setHint(this.scanning ? "Each item is added a moment after its tooltip shows. Pause before moving over things you don't want counted." : '');
    this.render();
  }

  /** A hover was read: say what it did, and show its line, highlighted (once you are done typing in a box). */
  showEvent(ev: HoverEvent): void {
    if (ev.kind === 'added' || ev.kind === 'fixed' || ev.kind === 'undone') this.save();
    if (ev.entryId) this.reveal = true;
    this.setHint(ev.text, !!ev.warn);
    this.render();
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
    $('apAddOpen').addEventListener('click', () => this.showAddBox($('apAddBox').hidden));
    $('apAddCancel').addEventListener('click', () => this.showAddBox(false));
    $('apAdd').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.showAddBox(false); }
      // Ctrl/⌘+Enter adds, as the button does
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('apAddBtn').click(); }
    });

    const table = $('apTable');
    table.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('cellinput') || !this.commit(t)) return;
      t.blur();
      this.changed();
    });
    // what waited while you typed in a box is drawn once focus has left the table (a change made is drawn at once)
    table.addEventListener('focusout', (e) => {
      if (!table.contains(e.relatedTarget as Node | null)) setTimeout(() => this.render());
    });
    // Enter in a Count box puts the count on its line and moves to the next line's Count box; after the last one,
    // to the filter button while the filter is on, else it stays on the line
    table.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key !== 'Enter' || t.dataset?.field !== 'qty') return;
      e.preventDefault();
      const countBox = (id: string | undefined) => (id ? table.querySelector<HTMLInputElement>(`input[data-field="qty"][data-id="${CSS.escape(id)}"]`) : null);
      const boxes = [...table.querySelectorAll<HTMLInputElement>('input[data-field="qty"]')];
      const next = boxes[boxes.indexOf(t) + 1]?.dataset.id, id = t.dataset.id;
      if (!this.commit(t)) return;
      this.changed();
      const box = countBox(next);
      if (box) { box.focus(); box.select(); }
      else if (this.onlyNeedCount) $('apNeedCount').focus();
      else countBox(id)?.focus();
    });
    table.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      const entry = b && this.find(b.dataset.id);
      if (!b || !entry) return;
      if (b.dataset.act === 'skip') entry.ignored = !entry.ignored || undefined;
      else this.data.entries = this.data.entries.filter((x) => x !== entry);
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
      // all read: the box closes; a line it couldn't read stays, to be fixed
      if (ok.length && !bad.length) { box.value = ''; this.showAddBox(false); }
    });

    $('apCopyStore').addEventListener('click', () => void this.copy(storePricesText(this.result(), this.settings.storeAdjust), 'Copied the store prices.'));
    const clear = $('apClear'), msg = $('apMsg');
    clear.addEventListener('click', () => {
      if (!this.data.entries.length) return;
      if (Date.now() - this.clearArmed > 4000) {
        // it asks first, on the button, and says so in the status message for a screen reader
        this.clearArmed = Date.now();
        clear.textContent = CLEAR_ASK;
        msg.textContent = `${CLEAR_ASK}.`;
        setTimeout(() => {
          clear.textContent = CLEAR_LABEL;
          if (msg.textContent === `${CLEAR_ASK}.`) msg.textContent = '';
        }, 4000);
        return;
      }
      this.data.entries = [];
      this.collector.forget();
      this.onlyNeedCount = false;
      this.clearArmed = 0; clear.textContent = CLEAR_LABEL;
      this.changed();
      msg.textContent = 'Cleared.';
    });
  }

  /** Opens the box for adding items by name, under the toolbar and focused, or closes it (focus back on its button). */
  private showAddBox(open: boolean): void {
    const box = $('apAddBox'), btn = $('apAddOpen');
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) $('apAdd').focus();
    else if (box.contains(document.activeElement)) btn.focus();
  }

  /** The clipboard, where the browser allows it. */
  private async copy(text: string, done: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); $('apMsg').textContent = done; }
    catch { $('apMsg').textContent = "Couldn't copy: this browser didn't allow it."; }
  }

  /**
   * Draws the view while it is shown, when your items, the hovers or the prices changed since it last drew.
   * `force` draws anyway (it was just shown); `overTyping` draws the table even with a box in it focused (a change
   * made in the table). Otherwise the table waits while you type in one of its boxes. Only what differs is written.
   */
  render(o: { force?: boolean; overTyping?: boolean } = {}): void {
    if (!this.d.shown()) return;
    const setup = { prices: this.d.engine.market.priced, items: this.data.entries.length };
    const key = `${this.collector.version}|${this.edits}|${this.d.version()}|${JSON.stringify(setup)}|${this.d.capturing()}|${this.d.paused()}`;
    if (!this.gate.due(key, o.force)) return;
    this.steps?.render(inventorySteps(setup, { openPrices: () => this.d.openPrices() }));
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#apTable');
    const r = this.result(), on = this.scanning, adjust = this.settings.storeAdjust;
    const scan = $<HTMLButtonElement>('apScan');
    setText(scan, scanLabel(on, this.d.paused() && this.d.capturing()));
    scan.classList.toggle('primary', !on);
    scan.setAttribute('aria-pressed', String(on));
    $<HTMLButtonElement>('apUndo').disabled = !this.collector.canUndo;
    setText($('apHint'), this.hint);
    setHidden($('apHint'), !this.hint);
    $('apHint').classList.toggle('bad', this.hintWarn);
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
    // the totals show once there is an item; till then the empty line says it all
    setHidden($('apTotals'), !this.data.entries.length);
    setText($('apTotal'), t.worth);
    setText($('apStore'), t.store);
    setText($('apLeft'), t.left);
    const body = $('apBody');
    setHtml(body, inventoryRowsHtml(lines, this.d.engine.market, { storeAdjust: adjust, lastId: this.collector.lastId, failed: this.d.failed }));
    setHidden($('apEmpty'), lines.length > 0);
    setHidden($('apTable'), !lines.length);
    if (this.reveal) {
      this.reveal = false;
      body.querySelector('tr.last')?.scrollIntoView({ block: 'nearest' });
    }
    $<HTMLButtonElement>('apCopyStore').disabled = !r.kinds;
    $<HTMLButtonElement>('apClear').disabled = !this.data.entries.length;
  }
}
