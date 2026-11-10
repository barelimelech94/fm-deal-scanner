import type { Engine } from '../engine';
import { fmt } from '../lib/format';
import { parseAmount } from '../lib/text';
import type { MarketData } from '../lib/types';
import { resolveKey } from '../market/matching';
import { mergeMarketPages } from '../market/mergeMarket';
import { parseTrackerPage } from '../market/parseTrackerPage';
import { fixSetSightings, mergeIntoMarket, newItem } from '../pricing/priceBook';
import { $, onFiles } from './dom';
import { DrawGate, setHidden, setHtml, setText } from './render';
import { bookRowHtml, bookRows, marketInfo, marketLoadText, NO_PRICE_TABLE, parsePriceLines, type BookSort } from './views';

const BOOK_MAX = 250;

/** Moves misread names onto the tracker's, and old star sightings to per-set prices. Says what it did, or nothing. */
export function tidyBook(e: Engine): string {
  const merged = mergeIntoMarket(e.book, e.market), sets = fixSetSightings(e.book, e.market);
  return [
    merged ? `Merged ${merged} price-book entr${merged === 1 ? 'y' : 'ies'} into the tracker's name for the same item.` : '',
    sets ? `Fixed ${sets} old star sighting${sets === 1 ? '' : 's'} that were priced per star instead of per set.` : '',
  ].filter(Boolean).join(' ');
}

export interface PricesDeps {
  engine: Engine;
  failed: ReadonlySet<string>;
  saveBook(): void;
  /** stores new market prices; false when the browser had no room */
  setMarket(m: MarketData): boolean;
  /** a price changed: the shop is judged again and every view redrawn */
  changed(): void;
  /** whether the view is the one shown */
  shown(): boolean;
  /** changes when the price book or the market prices can have changed (sightings come with the shop) */
  version(): string;
}

/** The Prices view: the price book with your prices and buy-under targets (and pasted in), and the market prices. */
export class PricesView {
  private sort: BookSort = { col: 'last', dir: -1 };
  private readonly gate = new DrawGate();

  constructor(private readonly d: PricesDeps) {}

  wire(): void {
    const e = this.d.engine;
    $('bookSearch').addEventListener('input', () => this.render(true));
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      th.addEventListener('click', () => {
        const col = th.dataset.col as BookSort['col'];
        this.sort = { col, dir: this.sort.col === col ? (-this.sort.dir as 1 | -1) : col === 'name' ? 1 : -1 };
        this.render(true);
      });
    }
    $('bookTable').addEventListener('change', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (!t.classList.contains('cellinput')) return;
      const key = t.dataset.key!, field = t.dataset.field as 'manualRef' | 'buyUnder';
      let it = e.book.items[key];
      if (!it) {
        const mk = e.market.get(key);
        if (!mk) return;
        it = e.book.items[key] = newItem(mk.n);
      }
      it[field] = t.value.trim() === '' ? null : parseAmount(t.value);
      this.d.saveBook(); t.blur(); this.d.changed();
    });
    $('bookTable').addEventListener('click', (ev) => {
      const k = (ev.target as HTMLElement).dataset?.del;
      if (!k) return;
      delete e.book.items[k];
      this.d.saveBook(); this.d.changed();
    });

    $('btnPaste').addEventListener('click', () => {
      const box = $<HTMLTextAreaElement>('pasteBox');
      const { ok, bad } = parsePriceLines(box.value);
      for (const { name, value } of ok) {
        const key = resolveKey({ market: e.market, book: e.book }, name, false);
        const mk = e.market.get(key);
        const it = e.book.items[key] ?? (e.book.items[key] = newItem(mk ? mk.n : name));
        it.manualRef = value;
      }
      this.d.saveBook(); this.d.changed();
      $('pasteMsg').textContent = `Added ${ok.length} price${ok.length === 1 ? '' : 's'}.`
        + (bad.length ? ` Couldn't read ${bad.length} line${bad.length === 1 ? '' : 's'}: ${bad.slice(0, 2).join(' / ')}` : '');
      if (!bad.length) box.value = '';
    });

    onFiles('fileMarket', (files) => this.loadMarket(files));
  }

  /**
   * Tracker pages picked: each is read, and those with a price table are added to the prices kept, oldest first.
   * Says what that did, naming the files that had no price table.
   */
  private async loadMarket(files: File[]): Promise<void> {
    const e = this.d.engine, pages: MarketData[] = [], skipped: string[] = [];
    for (const f of files) {
      const m = await f.text().then((html) => parseTrackerPage(html, f.lastModified || Date.now()), () => null);
      if (m?.items.length) pages.push(m);
      else skipped.push(f.name);
    }
    if (!pages.length) { $('marketMsg').textContent = NO_PRICE_TABLE; return; }
    const load = mergeMarketPages(e.market.data, pages);
    const kept = this.d.setMarket(load.data);
    const tidy = tidyBook(e);
    if (tidy) this.d.saveBook();
    this.d.changed();
    $('marketMsg').textContent = marketLoadText({
      files: pages.length, total: e.market.priced, changed: load.changed, world: load.data.world, replaced: load.replaced,
      skipped, npc: e.market.withNpc, tidy, kept,
    });
  }

  /** Draws the view while it is shown, when the prices changed since it last drew, or when `force`d. */
  render(force = false): void {
    if (!this.d.shown() || !this.gate.due(this.d.version(), force)) return;
    const e = this.d.engine;
    setHtml($('marketAge'), marketInfo(e.market, e.now()));
    // typing in a price box: leave the table alone until the change is made
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#bookTable')) { this.gate.reset(); return; }
    const q = $<HTMLInputElement>('bookSearch').value;
    const all = bookRows(e, q, this.sort), rows = all.slice(0, BOOK_MAX), now = e.now();
    setHtml($<HTMLTableElement>('bookTable').tBodies[0]!, rows.map((r) => bookRowHtml(r, now, this.d.failed)).join(''));
    const empty = $('bookEmpty');
    setHidden(empty, rows.length > 0);
    setText(empty, q.trim() ? 'Nothing matches that name.' : 'Empty. It fills as you open shops, or add your prices below.');
    const hint = $('bookHint');
    setText(hint, all.length > BOOK_MAX ? `Showing ${BOOK_MAX} of ${fmt(all.length)}. Type more of the name to narrow it.`
      : !q.trim() && e.market.size ? `Type in the filter to find any of the ${fmt(e.market.size)} items the price tracker lists, and set your own price or buy-under on it.` : '');
    setHidden(hint, !hint.textContent);
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      const on = th.dataset.col === this.sort.col;
      setHtml(th, (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${this.sort.dir > 0 ? '▲' : '▼'}</span>` : ''));
      th.setAttribute('aria-sort', on ? (this.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
  }
}
