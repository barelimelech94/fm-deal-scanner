import type { Engine } from '../engine';
import { cap, clock, esc } from '../lib/format';
import type { DisplayRow, ShopSession } from '../shop/session';
import { $ } from './dom';
import { DrawGate, setHidden, setHtml, setText } from './render';
import {
  cleanSort, dealLine, dealsHtml, freshDeal, hoverText, iconHtml, nextSort, shopMeta, shopRowHtml, sortRows, type ShopSort,
} from './views';

export interface DealsDeps {
  engine: Engine;
  session: ShopSession;
  /** icon addresses that failed to load */
  failed: ReadonlySet<string>;
  saveSettings(): void;
  /** the shop's order or its deals changed here: the overlay, which shows them too, follows */
  overlay(): void;
  /** whether the view is the one shown */
  shown(): boolean;
  /** changes when the shop or anything that prices it changed */
  version(): string;
}

/** The Deals view: the open shop with its deal banner and hovered item, and the deals found this session. */
export class DealsView {
  private readonly gate = new DrawGate();

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
    this.render(true);
    this.d.overlay();
  }

  wire(): void {
    $('btnClearDeals').addEventListener('click', () => { this.d.session.clearDeals(); this.render(); this.d.overlay(); });
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

  /**
   * Draws the view while it is shown, when the shop or the prices changed since it last drew. `force` draws
   * anyway (it was just shown, or time moved on); only what differs is written.
   */
  render(force = false): void {
    if (!this.d.shown() || !this.gate.due(this.d.version(), force)) return;
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
      setHtml(th, (th.textContent ?? '').replace(/[▲▼]/g, '').trim() + (on ? `<span class="arrow">${s.dir > 0 ? '▲' : '▼'}</span>` : ''));
      th.setAttribute('aria-sort', on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none');
    }
    setHidden($('shopSortReset'), s.col === 'best');
  }

  private renderShop(): void {
    const { session, engine } = this.d, m = engine.market;
    const rows = this.rows();
    const table = $<HTMLTableElement>('shopTable');
    setHtml(table.tBodies[0]!, rows.map((r) => shopRowHtml(r, m, this.d.failed)).join(''));
    setHidden(table, !rows.length);
    setHidden($('shopEmpty'), !!rows.length);
    setText($('shopMeta'), shopMeta(session, rows));
    const hv = hoverText(session.hover, engine);
    setHidden($('hoverLine'), !hv);
    if (hv && session.hover) setHtml($('hoverLine'), `${this.icon(session.hover.key)}<span><b>Hovered</b> ${esc(hv)}</span>`);
    const deal = freshDeal(session, engine.now());
    setHidden($('dealBanner'), !deal);
    if (deal) {
      const l = dealLine(deal, m);
      setText($('dealLabel'), `Deal at ${clock(deal.ts)}`);
      setHtml($('dealWhat'), `${this.icon(deal.key)}<span>${esc(l.name)}</span>`);
      setText($('dealMath'), `${cap(l.listing)}, ${l.why}`);
      setHtml($('dealProfit'), l.profit ? `${esc(l.profit)}<small>${esc(l.profitNote)}</small>` : '');
    }
  }

  private renderDeals(): void {
    setHtml($('dealList'), dealsHtml(this.d.session.deals, this.d.engine.market, this.d.failed));
    setHidden($('dealsEmpty'), this.d.session.deals.length > 0);
  }
}
