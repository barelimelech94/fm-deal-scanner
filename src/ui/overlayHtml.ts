// HTML for the pop-out overlay, built from what the page knows. Pure: everything comes in as arguments, so it is
// tested without a browser.
import { cap, clock, esc, fmt, fmtEach, fmtShort, salesTxt } from '../lib/format';
import type { ScanMode } from '../lib/types';
import type { MarketIndex } from '../market/marketIndex';
import type { Deal, DisplayRow } from '../shop/session';
import { dealLine, iconHtml, pctCell, VERDICT } from './views';
import { scanLabel } from './inventoryHtml';

/** The item hovered last in your inventory, as the overlay shows it. */
export interface GlanceItem {
  key: string;
  name: string;
  /** what to type in your store, each; null with no price */
  listAt: number | null;
  /** its price each at the chosen price, and that price's name (Market or Asking) */
  unit: number | null;
  priceLabel: string;
  /** the tracker's sales of it, when it lists it */
  sales: number | null;
}

/** What the overlay shows in inventory mode: the item hovered last, the running worth, and how many items. */
export interface InventoryGlance {
  last: GlanceItem | null;
  worth: number;
  items: number;
  hint: string;
}

export interface OverlayState {
  mode: ScanMode;
  open: boolean;
  capturing: boolean;
  /** scanning your items (inventory mode) */
  scanning: boolean;
  /** you paused scanning your items */
  paused?: boolean;
  rows: DisplayRow[];
  deal: Deal | null;
  hover: string;
  hoverKey: string | null;
  inventory: InventoryGlance;
}

/** The overlay's row: price now, the usual price it's measured against, and how far apart they are. */
export function overlayRowHtml(r: DisplayRow, market: MarketIndex, failed?: ReadonlySet<string>): string {
  const pct = pctCell(r.pct);
  const label = `${esc(r.name)}${r.truncated ? '…' : ''}`
    + (r.unchecked ? ` <span class="cnt">${r.count} more, not hovered</span>` : r.count > 1 ? ` <span class="cnt">×${r.count}</span>` : '');
  const chip = `<span class="chip ${r.verdict}"${r.why ? ` title="${esc(r.why)}"` : ''}>${r.verdict === 'new' ? 'No price' : VERDICT[r.verdict]}</span>`;
  return `<tr class="v-${r.verdict}"><td class="name"><span class="nm">${iconHtml(market, r.key, failed)}<span class="nm-n" title="${esc(r.name)}">${label}</span></span></td>`
    + `<td class="n">${fmtShort(r.unit)}</td><td class="n dim">${r.usual == null ? '–' : fmtShort(r.usual)}</td><td class="n ${pct.cls}">${pct.text}</td><td>${chip}</td></tr>`;
}

/** The header: the two-way switch that sets the mode (and the page follows), and what capture is doing. */
function headHtml(o: OverlayState): string {
  const doing = !o.capturing ? 'Not capturing' : o.mode === 'inventory' ? (o.scanning ? 'Scanning' : 'Paused') : o.open ? 'Shop open' : 'Watching';
  const tab = (m: ScanMode, label: string) => `<button data-act="mode-${m}" aria-pressed="${o.mode === m}">${label}</button>`;
  return `<div class="ph"><span class="modeswitch" role="group" aria-label="What to scan">${tab('deals', 'Deals')}${tab('inventory', 'Inventory')}</span><span>${doing}</span></div>`;
}

/** Deals: the newest deal as a banner, the hovered item's line, then the best eight rows of the open shop. */
function dealsBodyHtml(o: OverlayState, market: MarketIndex, failed?: ReadonlySet<string>): string {
  const rows = o.rows.slice(0, 8);
  const l = o.deal ? dealLine(o.deal, market) : null;
  const deal = l && o.deal
    ? `<div class="banner"><span class="label">Deal at ${clock(o.deal.ts)}</span><span class="what">${iconHtml(market, o.deal.key, failed)}<span>${esc(l.name)}</span></span><span class="math">${esc(cap(l.listing))}, ${esc(l.why)}</span><span class="profit">${esc(l.profit)}</span></div>`
    : '';
  const hover = o.hover && o.hoverKey != null ? `<p class="hovered">${iconHtml(market, o.hoverKey, failed)}<span>${esc(o.hover)}</span></p>` : '';
  const table = rows.length
    ? '<table><colgroup><col><col style="width:62px"><col style="width:62px"><col style="width:50px"><col style="width:72px"></colgroup>'
      + '<thead><tr><th>Item</th><th class="n">Each</th><th class="n">Usual</th><th class="n" title="Price now vs usual price">%</th><th></th></tr></thead>'
      + `<tbody>${rows.map((r) => overlayRowHtml(r, market, failed)).join('')}</tbody></table>`
    : '<p class="empty">Open a shop in the game.</p>';
  return deal + hover + table;
}

/**
 * Inventory: Scan my items, Pause or Resume, the item hovered last with its List at price large enough to read while the
 * game has focus (its price and sales under it), then the running worth and how many items.
 */
function inventoryBodyHtml(o: OverlayState, market: MarketIndex, failed?: ReadonlySet<string>): string {
  const g = o.inventory, it = g.last;
  const paused = !!o.paused && o.capturing;
  const scan = `<button class="btn${o.scanning ? '' : ' primary'}" data-act="scan" aria-pressed="${o.scanning}">${scanLabel(o.scanning, paused)}</button>`;
  const last = it
    ? `<div class="plast">${iconHtml(market, it.key, failed)}<div class="plast-t"><span class="plast-n">${esc(it.name)}</span>`
      + `<span class="plast-l"><small>List at</small>${it.listAt == null ? 'no price' : fmt(it.listAt)}</span>`
      + `<span class="sub">${esc([it.unit == null ? '' : `${it.priceLabel} ${fmtEach(it.unit)}`, it.sales == null ? '' : salesTxt(it.sales)].filter(Boolean).join(' · '))}</span></div></div>`
    : `<p class="empty">${o.scanning ? 'Point at an item in the game.' : `Press ${scanLabel(false, paused)}, then point at your items in the game.`}</p>`;
  const worth = `<div class="pworth"><span class="dim">Worth</span><b>${fmt(g.worth)}</b><span class="dim">${fmt(g.items)} item${g.items === 1 ? '' : 's'}</span></div>`;
  return `<div class="pscan">${scan}</div>${last}${worth}` + (g.hint ? `<p class="apnote">${esc(g.hint)}</p>` : '');
}

/** The overlay: its header with the mode switch, then the mode's body. */
export function overlayHtml(o: OverlayState, market: MarketIndex, failed?: ReadonlySet<string>): string {
  return headHtml(o) + (o.mode === 'inventory' ? inventoryBodyHtml(o, market, failed) : dealsBodyHtml(o, market, failed));
}
