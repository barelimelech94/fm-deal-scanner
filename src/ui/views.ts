// HTML for the page and the overlay, built from the shop state. Pure: everything comes in as
// arguments, so it is tested without a browser.
import type { Engine } from '../engine';
import { iconUrl } from '../icons';
import { ago, cap, clock, DAY, esc, fmt, fmtEach, fmtShort, salesTxt, signed } from '../lib/format';
import { norm, parseAmount } from '../lib/text';
import type { BookItem, MarketItem, Settings, ShopSortCol, UsualSource, Verdict } from '../lib/types';
import { isRough, marketTip, type MarketIndex } from '../market/marketIndex';
import { usualPrice } from '../pricing/evaluate';
import { sightingStats } from '../pricing/priceBook';
import type { Deal, DisplayRow, Hover, ShopSession } from '../shop/session';

export const VERDICT: Record<Verdict, string> = { deal: 'Deal', fair: 'Fair', high: 'Pricey', new: 'No price yet', sold: 'Sold', unsure: 'Check' };
const ORDER: Record<Verdict, number> = { deal: 0, unsure: 1, fair: 2, new: 3, high: 4, sold: 5 };

/** The item's picture, over the tracker's emoji for it (or "?" when the tracker doesn't list it), which shows until or unless it loads. */
export function iconHtml(market: MarketIndex, key: string, failed?: ReadonlySet<string>): string {
  return iconFor(market.get(key), market.iconId(key), failed);
}

function iconFor(mk: MarketItem | null, id: number | null, failed: ReadonlySet<string> = new Set()): string {
  const src = iconUrl(id);
  const img = src && !failed.has(src) ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
  return mk
    ? `<span class="ico" data-e="${esc(mk.e || '•')}" aria-hidden="true">${img}</span>`
    : `<span class="ico unk" data-e="?" title="Not on the price tracker" aria-hidden="true">${img}</span>`;
}

export interface DealLine { name: string; listing: string; why: string; profit: string; /** what the profit is after: the sales fee, or nothing when an NPC buys it */ profitNote: string }

/** A listing and what it's measured against, in words. */
export function dealLine(d: DisplayRow, market: MarketIndex): DealLine {
  const mk = market.get(d.key);
  const listing = `${d.set ? `set of ${d.qty}` : d.qty} for ${fmt(d.price)}` + (d.units > 1 ? ` (${fmtEach(d.unit)} each)` : '');
  const from = d.usualSrc === 'yours' ? ' (your price)' : d.usualSrc === 'market' ? ` (market${mk ? `, ${salesTxt(mk.s)}` : ''})` : '';
  const why = d.npcFlip && d.npc != null ? `an NPC pays ${fmtEach(d.npc)} each for it`
    : d.target && d.usual == null ? 'under your buy-under price' : `usual ${fmtEach(d.usual)}${from}` + (d.stats ? `, for its stats: ${d.stats.summary}` : '');
  return { name: d.name + (d.truncated ? '…' : ''), listing, why, profit: d.profit != null ? signed(d.profit) : '', profitNote: d.npcFlip ? 'selling to an NPC' : 'after fee' };
}

export interface ShopSort { col: ShopSortCol; dir: 1 | -1 }
export const BEST_FIRST: ShopSort = { col: 'best', dir: 1 };
export const SHOP_SORT_COLS: readonly ShopSortCol[] = ['best', 'name', 'unit', 'usual', 'pct', 'profit'];

/** The way a column starts when first clicked: most profit first, biggest discount first, cheapest first. */
const FIRST_DIR: Record<ShopSortCol, 1 | -1> = { best: 1, name: 1, unit: 1, usual: -1, pct: 1, profit: -1 };

/** The sort after a click on a column: the same column flips, another starts in its natural direction. */
export const nextSort = (cur: ShopSort, col: ShopSortCol): ShopSort =>
  col === cur.col ? { col, dir: (-cur.dir) as 1 | -1 } : { col, dir: FIRST_DIR[col] };

/** A saved sort, checked: anything unknown is the default. */
export const cleanSort = (col: unknown, dir: unknown): ShopSort =>
  SHOP_SORT_COLS.includes(col as ShopSortCol) ? { col: col as ShopSortCol, dir: dir === -1 ? -1 : 1 } : BEST_FIRST;

/** Deals first, then by how far under the usual price. */
const bestFirst = (a: DisplayRow, b: DisplayRow): number => ORDER[a.verdict] - ORDER[b.verdict] || (a.pct ?? 9) - (b.pct ?? 9);

const cell = (r: DisplayRow, col: ShopSortCol): number | string | null =>
  col === 'name' ? r.name : col === 'unit' ? r.unit : col === 'usual' ? r.usual : col === 'pct' ? r.pct : col === 'profit' ? r.profit : null;

/**
 * Orders the shop's rows. By default deals come first, then by how far under the usual price. By a column,
 * sold rows still come last (they can't be bought), so do rows with nothing in that column (no usual price,
 * so no profit), whichever way it runs; ties fall back to the default order.
 */
export function sortRows(rows: DisplayRow[], sort: ShopSort = BEST_FIRST): DisplayRow[] {
  if (sort.col === 'best') return rows.sort(bestFirst);
  return rows.sort((a, b) => {
    const sold = (a.verdict === 'sold' ? 1 : 0) - (b.verdict === 'sold' ? 1 : 0);
    if (sold) return sold;
    const x = cell(a, sort.col), y = cell(b, sort.col);
    if (x == null || y == null) return x == null && y == null ? bestFirst(a, b) : x == null ? 1 : -1;
    const d = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return d ? d * sort.dir : bestFirst(a, b);
  });
}

const pctCell = (pct: number | null) => ({
  text: pct == null ? '–' : `${pct > 0 ? '+' : ''}${Math.round(pct * 100)}%`,
  cls: pct == null ? 'dim' : pct < 0 ? 'pos' : pct > 0.15 ? 'neg' : '',
});

const usualTip = (r: DisplayRow, mk: MarketItem | null) =>
  (r.npc != null ? `An NPC pays ${fmtEach(r.npc)} each for it${r.npcFlip ? ', more than this listing costs' : ''}. ` : '')
  + (r.stats && r.usualBase ? `${fmtEach(r.usualBase)} × ${r.stats.mult.toFixed(2)} for its stats (${r.stats.summary}). ` : '')
  + (r.usualSrc === 'yours' ? 'Your price. ' : r.usualSrc === 'seen' ? 'From your own sightings. ' : '') + marketTip(mk);

/** A row reads like the game's own shop row: the name, and under it "1 for 79,999". */
export function shopRowHtml(r: DisplayRow, market: MarketIndex, failed?: ReadonlySet<string>): string {
  const mk = market.get(r.key);
  const pct = pctCell(r.pct);
  const sold = r.verdict === 'sold';
  const prof = r.profit == null || sold ? '–' : signed(r.profit);
  const profCls = r.profit == null || sold ? 'dim' : r.profit > 0 ? 'pos' : 'neg';
  const label = `${esc(r.name)}${r.truncated ? '…' : ''}`
    + (r.unchecked ? ` <span class="cnt">${r.count} more, not hovered</span>` : r.count > 1 ? ` <span class="cnt">×${r.count}</span>` : '');
  const listing = `${r.set ? `set of ${r.qty}` : r.qty} for ${fmt(r.price)}` + (r.stats ? `, ${r.stats.summary}` : '');
  const tip = usualTip(r, mk);
  return `<tr class="v-${r.verdict}">
    <td class="name"><span class="nm">${iconHtml(market, r.key, failed)}<span class="nm-t"><span class="nm-n">${label}</span><span class="sub"${r.set ? ` title="One item holding ${r.qty}, priced as a set"` : ''}>${esc(listing)}</span></span></span></td>
    <td class="n">${fmtEach(r.unit)}</td>
    <td class="n dim"${tip ? ` title="${esc(tip)}"` : ''}>${r.usual == null ? '–' : fmtEach(r.usual) + (r.stats ? '<span class="sub">by stats</span>' : '')}${r.npc != null ? `<span class="sub">NPC ${fmtEach(r.npc)}</span>` : ''}</td>
    <td class="n ${pct.cls}">${pct.text}</td>
    <td class="n ${profCls}">${prof}</td>
    <td><span class="chip ${r.verdict}"${r.why ? ` title="${esc(r.why)}"` : ''}>${VERDICT[r.verdict]}</span></td>
  </tr>`;
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

/** What the last hovered tooltip said, and what that makes the item worth. */
export function hoverText(h: Hover | null, e: Engine): string {
  if (!h || e.now() - h.ts > 90e3) return '';
  const u = usualPrice(e.book.items[h.key], e.market.get(h.key), e.settings, e.now());
  const worth = u ? ` Worth about ${fmt(u.value * h.mult)} (usual ${fmtEach(u.value)}).` : ' No usual price for it yet.';
  return `${h.name}: ${h.summary}.${worth}${h.rec ? '' : " Not in this shop's list."}`;
}

/** The newest deal, while it is fresh enough to show in the banner. */
export const freshDeal = (s: ShopSession, now: number): Deal | null => (s.lastDeal && now - s.lastDeal.ts < 5 * 60e3 ? s.lastDeal : null);

export function shopMeta(s: ShopSession, rows: readonly DisplayRow[]): string {
  if (!s.open) return 'No shop open';
  const total = s.listingCount(), deals = rows.filter((r) => r.verdict === 'deal').length;
  return `${total} listing${total === 1 ? '' : 's'}${deals ? `, ${deals} deal${deals === 1 ? '' : 's'}` : ''}, opened ${clock(s.since)}`;
}

export function dealsHtml(deals: readonly Deal[], market: MarketIndex, failed?: ReadonlySet<string>): string {
  return deals.map((d) => {
    const l = dealLine(d, market);
    return `<li><span class="t">${clock(d.ts)}</span><span class="w"><span class="nm">${iconHtml(market, d.key, failed)}<span class="nm-t"><span class="nm-n">${esc(l.name)}</span><span class="sub">${esc(cap(l.listing))}, ${esc(l.why)}</span></span></span></span><span class="p">${esc(l.profit)}</span></li>`;
  }).join('');
}

export interface OverlayState { open: boolean; capturing: boolean; rows: DisplayRow[]; deal: Deal | null; hover: string; hoverKey: string | null }

/** The overlay: the newest deal on top, then the best eight rows of the open shop. */
export function overlayHtml(o: OverlayState, market: MarketIndex, failed?: ReadonlySet<string>, extra = ''): string {
  const rows = o.rows.slice(0, 8);
  const l = o.deal ? dealLine(o.deal, market) : null;
  const head = `<div class="ph"><b>FM Deal Scanner</b><span>${o.open ? 'Shop open' : o.capturing ? 'Watching' : 'Not capturing'}</span></div>`;
  const hover = o.hover && o.hoverKey != null ? `<p class="hovered">${iconHtml(market, o.hoverKey, failed)}<span>${esc(o.hover)}</span></p>` : '';
  const deal = l && o.deal
    ? `<div class="banner"><span class="label">Deal at ${clock(o.deal.ts)}</span><span class="what">${iconHtml(market, o.deal.key, failed)}<span>${esc(l.name)}</span></span><span class="math">${esc(cap(l.listing))}, ${esc(l.why)}</span><span class="profit">${esc(l.profit)}</span></div>`
    : '';
  const table = rows.length
    ? '<table><colgroup><col><col style="width:62px"><col style="width:62px"><col style="width:50px"><col style="width:72px"></colgroup>'
      + '<thead><tr><th>Item</th><th class="n">Each</th><th class="n">Usual</th><th class="n" title="Price now vs usual price">%</th><th></th></tr></thead>'
      + `<tbody>${rows.map((r) => overlayRowHtml(r, market, failed)).join('')}</tbody></table>`
    : '<p class="empty">Open a shop in the game.</p>';
  return head + extra + hover + deal + table;
}

// ---------- price book ----------

export interface BookRow {
  key: string; it: BookItem | null; mk: MarketItem | null; name: string; icon: number | null;
  n: number; usual: number | null; usualSrc: UsualSource | null; sales: number | null; low: number | null; last: number | null;
}
export type BookSort = { col: 'name' | 'n' | 'usual' | 'low' | 'last'; dir: 1 | -1 };

/** Your items, plus tracker items whose name matches the filter. */
export function bookRows(e: Engine, query: string, sort: BookSort): BookRow[] {
  const q = norm(query);
  const keys = new Set(Object.keys(e.book.items));
  if (q) for (const k of e.market.primary) if (k.includes(q)) keys.add(k);
  const now = e.now();
  const rows = [...keys].map((key): BookRow => {
    const it = e.book.items[key] ?? null, mk = e.market.get(key);
    const st = sightingStats(it, now), u = usualPrice(it, mk, e.settings, now);
    return { key, it, mk, name: it ? it.name : mk?.n ?? key, icon: e.market.iconId(key), n: st.n, usual: u?.value ?? null, usualSrc: u?.src ?? null, sales: mk?.s ?? null, low: st.low, last: st.last };
  }).filter((r) => !q || norm(r.name).includes(q) || r.key.includes(q));
  const { col, dir } = sort;
  return rows.sort((a, b) => (col === 'name' ? dir * a.name.localeCompare(b.name) : dir * ((a[col] ?? -Infinity) - (b[col] ?? -Infinity))));
}

export function bookRowHtml(r: BookRow, now: number, failed?: ReadonlySet<string>): string {
  const dash = '<span class="dim">–</span>';
  const tag = r.usualSrc === 'yours' ? ' <span class="dim">you</span>' : r.usualSrc === 'seen' ? ' <span class="dim">seen</span>' : '';
  const warn = isRough(r.mk) ? ' <span class="warn">⚠</span>' : '';
  const sub = r.mk && r.sales != null ? salesTxt(r.sales) : '';
  const it = r.it;
  return `<tr>
    <td class="name"><span class="nm">${iconFor(r.mk, r.icon, failed)}<span class="nm-n">${esc(r.name)}</span></span></td>
    <td class="n">${r.n}</td>
    <td class="n"${r.mk ? ` title="${esc(marketTip(r.mk))}"` : ''}>${r.usual == null ? dash : fmtEach(r.usual) + tag}${warn}${sub ? `<small class="sub">${sub}</small>` : ''}</td>
    <td class="n">${fmtEach(r.low)}</td>
    <td class="n dim">${ago(r.last, now)}</td>
    <td class="n"><input class="cellinput" data-key="${esc(r.key)}" data-field="manualRef" value="${it?.manualRef ? fmt(it.manualRef) : ''}" placeholder="–" aria-label="Your usual price for ${esc(r.name)}"></td>
    <td class="n"><input class="cellinput" data-key="${esc(r.key)}" data-field="buyUnder" value="${it?.buyUnder ? fmt(it.buyUnder) : ''}" placeholder="–" aria-label="Buy-under price for ${esc(r.name)}"></td>
    <td>${it ? `<button class="x" data-del="${esc(r.key)}" aria-label="Remove ${esc(r.name)}" title="Remove">×</button>` : ''}</td>
  </tr>`;
}

export function marketInfo(m: MarketIndex, now: number): string {
  const d = m.data, n = m.priced;
  if (!n) return 'None loaded yet.';
  const old = d.asOf && now - d.asOf > 3 * DAY;
  return `<b>${fmt(n)} prices</b> for ${esc(d.world || 'your world')}, from ${esc(d.updated || new Date(d.asOf).toLocaleDateString())} (${ago(d.asOf, now)}).`
    + (old ? ' <span class="warn">Getting old, update them.</span>' : '')
    + (m.withNpc ? ` ${fmt(m.withNpc)} have an NPC shop price.` : ' <span class="warn">No NPC prices: load the tracker page again to get them.</span>');
}

export const rulesSummary = (st: Settings): string =>
  `${st.discount}% off, ${fmt(st.minProfit)}+ profit, ${st.fee}% fee` + (st.market === 'off' ? ', market prices off' : '') + (st.area === 'manual' ? ', marked area' : '');

/** "Cape INT Scroll: Lesser, 80k" lines: a name and a price each. */
export function parsePriceLines(text: string): { ok: { name: string; value: number }[]; bad: string[] } {
  const ok: { name: string; value: number }[] = [], bad: string[] = [];
  for (const line of text.split(/\n/).map((s) => s.trim()).filter(Boolean)) {
    const m = line.match(/^(.*?)[\s,;:=\t-]+([\d.,]+\s*[kKmM]?)\s*(?:mesos?|each|ea)?\s*$/);
    const value = m ? parseAmount(m[2]!) : null;
    const name = m ? m[1]!.replace(/[\s,;:=\t-]+$/, '').trim() : '';
    if (!m || !value || !name || !/[A-Za-z]/.test(name)) bad.push(line);
    else ok.push({ name, value });
  }
  return { ok, bad };
}
