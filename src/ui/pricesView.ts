import type { Engine } from '../engine';
import { fmt } from '../lib/format';
import { parseAmount } from '../lib/text';
import type { MarketData } from '../lib/types';
import { resolveKey } from '../market/matching';
import { parseTrackerPage } from '../market/parseTrackerPage';
import { fixSetSightings, mergeIntoMarket, newItem } from '../pricing/priceBook';
import { $, onFile } from './dom';
import { bookRowHtml, bookRows, marketInfo, parsePriceLines, type BookSort } from './views';

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
}

/** The Prices view: the price book with your prices and buy-under targets, the market prices, and your prices pasted in. */
export class PricesView {
  private sort: BookSort = { col: 'last', dir: -1 };

  constructor(private readonly d: PricesDeps) {}

  wire(): void {
    const e = this.d.engine;
    $('bookSearch').addEventListener('input', () => this.render());
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      th.addEventListener('click', () => {
        const col = th.dataset.col as BookSort['col'];
        this.sort = { col, dir: this.sort.col === col ? (-this.sort.dir as 1 | -1) : col === 'name' ? 1 : -1 };
        this.render();
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

    onFile('fileMarket', async (f) => {
      try {
        const m = parseTrackerPage(await f.text(), f.lastModified || Date.now());
        if (!m.items.length) throw new Error('no price table');
        const kept = this.d.setMarket(m);
        const tidy = tidyBook(e);
        if (tidy) this.d.saveBook();
        this.d.changed();
        $('marketMsg').textContent = `Loaded ${fmt(e.market.priced)} market prices${m.world ? ` for ${m.world}` : ''}.` + (e.market.withNpc ? ` ${fmt(e.market.withNpc)} have an NPC shop price.` : '')
          + (tidy ? ` ${tidy}` : '') + (kept ? '' : ' The browser had no room to keep them, so load the file again next time.');
      } catch {
        $('marketMsg').textContent = "That page has no price table. On meso.watch, wait until your world's prices show, save the page as Webpage, Complete, and pick that .html file.";
      }
    });
  }

  render(): void {
    const e = this.d.engine;
    $('marketAge').innerHTML = marketInfo(e.market, e.now());
    // typing in a price box: leave the table alone until the change is made
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.closest('#bookTable')) return;
    const q = $<HTMLInputElement>('bookSearch').value;
    const all = bookRows(e, q, this.sort), rows = all.slice(0, BOOK_MAX), now = e.now();
    $<HTMLTableElement>('bookTable').tBodies[0]!.innerHTML = rows.map((r) => bookRowHtml(r, now, this.d.failed)).join('');
    const empty = $('bookEmpty');
    empty.hidden = rows.length > 0;
    empty.textContent = q.trim() ? 'Nothing matches that name.' : 'Empty. It fills as you open shops, or paste prices below.';
    const hint = $('bookHint');
    hint.textContent = all.length > BOOK_MAX ? `Showing ${BOOK_MAX} of ${fmt(all.length)}. Type more of the name to narrow it.`
      : !q.trim() && e.market.size ? `Type in the filter to find any of the ${fmt(e.market.size)} items the price tracker lists, and set your own price or buy-under on it.` : '';
    hint.hidden = !hint.textContent;
    for (const th of document.querySelectorAll<HTMLElement>('#bookTable th.sortable')) {
      const on = th.dataset.col === this.sort.col;
      th.innerHTML = (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${this.sort.dir > 0 ? '▲' : '▼'}</span>` : '');
      th.setAttribute('aria-sort', on ? (this.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
  }
}
