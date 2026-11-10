import type { Engine } from '../engine';
import { cap, clock, esc } from '../lib/format';
import type { DisplayRow, ShopSession } from '../shop/session';
import { $ } from './dom';
import {
  cleanSort, dealLine, dealsHtml, freshDeal, hoverText, iconHtml, nextSort, shopMeta, shopRowHtml, sortRows, type ShopSort,
} from './views';

export interface DealsDeps {
  engine: Engine;
  session: ShopSession;
  /** icon addresses that failed to load */
  failed: ReadonlySet<string>;
  saveSettings(): void;
  /** the shop's order changed: the overlay follows it */
  sorted(): void;
}

/** The Deals view: the open shop with its deal banner and hovered item, and the deals found this session. */
export class DealsView {
  constructor(private readonly d: DealsDeps) {}

  private get settings() { return this.d.engine.settings; }

  /** How the open shop is ordered, from the saved setting. */
  sort(): ShopSort { return cleanSort(this.settings.shopSort, this.settings.shopSortDir); }

  /** The open shop's rows, in the order chosen. */
  rows(): DisplayRow[] { return sortRows(this.d.session.displayRows(), this.sort()); }

  private setSort(s: ShopSort): void {
    this.settings.shopSort = s.col;
    this.settings.shopSortDir = s.dir;
    this.d.saveSettings();
    this.render();
    this.d.sorted();
  }

  wire(): void {
    $('btnClearDeals').addEventListener('click', () => { this.d.session.clearDeals(); this.render(); });
    // click a column to order by it, again to flip; the choice is kept for the next shop
    for (const th of document.querySelectorAll<HTMLElement>('#shopTable th.sortable')) {
      const pick = () => this.setSort(nextSort(this.sort(), th.dataset.col as ShopSort['col']));
      th.addEventListener('click', pick);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    $('shopSortReset').addEventListener('click', () => this.setSort({ col: 'best', dir: 1 }));
  }

  /** A new deal: the banner flashes. */
  flash(): void {
    const b = $('dealBanner');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  }

  render(): void {
    this.renderHeaders();
    this.renderShop();
    this.renderDeals();
  }

  private icon(key: string): string { return iconHtml(this.d.engine.market, key, this.d.failed); }

  /** Arrows and aria on the shop table's headers, and the way back to the default order. */
  private renderHeaders(): void {
    const s = this.sort();
    for (const th of document.querySelectorAll<HTMLElement>('#shopTable th.sortable')) {
      const on = th.dataset.col === s.col;
      th.innerHTML = (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${s.dir > 0 ? '▲' : '▼'}</span>` : '');
      th.setAttribute('aria-sort', on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    $('shopSortReset').hidden = s.col === 'best';
  }

  private renderShop(): void {
    const { session, engine } = this.d, m = engine.market;
    const rows = this.rows();
    const table = $<HTMLTableElement>('shopTable');
    table.tBodies[0]!.innerHTML = rows.map((r) => shopRowHtml(r, m, this.d.failed)).join('');
    table.hidden = !rows.length;
    $('shopEmpty').hidden = !!rows.length;
    $('shopMeta').textContent = shopMeta(session, rows);
    const hv = hoverText(session.hover, engine);
    $('hoverLine').hidden = !hv;
    if (hv && session.hover) $('hoverLine').innerHTML = `${this.icon(session.hover.key)}<span><b>Hovered</b> ${esc(hv)}</span>`;
    const deal = freshDeal(session, engine.now());
    $('dealBanner').hidden = !deal;
    if (deal) {
      const l = dealLine(deal, m);
      $('dealLabel').textContent = `Deal at ${clock(deal.ts)}`;
      $('dealWhat').innerHTML = `${this.icon(deal.key)}<span>${esc(l.name)}</span>`;
      $('dealMath').textContent = `${cap(l.listing)}, ${l.why}`;
      $('dealProfit').innerHTML = l.profit ? `${esc(l.profit)}<small>${esc(l.profitNote)}</small>` : '';
    }
  }

  private renderDeals(): void {
    $('dealList').innerHTML = dealsHtml(this.d.session.deals, this.d.engine.market, this.d.failed);
    $('dealsEmpty').hidden = this.d.session.deals.length > 0;
  }
}
