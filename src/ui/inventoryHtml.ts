// HTML and words for the Inventory view, built from your items' prices. Pure, like views.ts: everything comes in
// as arguments, so it is tested without a browser.
import { listPrice, MODE_LABEL, needsCount, storeTotal, type AppraisalLine, type AppraisalResult, type LineSource, type LineTag } from '../appraisal/appraise';
import { esc, fmt, fmtEach } from '../lib/format';
import { marketTip, type MarketIndex } from '../market/marketIndex';
import type { InventoryGlance } from './overlayHtml';
import type { SetupStep } from './setupSteps';
import { iconHtml } from './views';

export const TAG_TEXT: Record<LineTag, string> = { priced: 'Priced', rough: 'Rough', unpriced: 'No price', ignored: 'Skipped' };
const SRC_TEXT: Record<LineSource, string> = { yours: 'your price', market: 'market', seen: 'your sightings', line: 'typed here', npc: 'NPC price' };

const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** What a line's tag means, for its tooltip. */
function tagTip(l: AppraisalLine, market: MarketIndex): string {
  if (l.tag === 'unpriced') return 'No price on the tracker or in your sightings. Type one in its List at box.';
  if (l.tag === 'ignored') return 'Left out of the worth.';
  const tip = marketTip(market.get(l.entry.key));
  if (l.src === 'npc') return 'No market price, so this is what an NPC pays for it: the least it is worth. Type a price to use your own.';
  return l.tag === 'rough' ? `A rough guide: fewer than 5 sales, or copies sell for very different prices. ${tip}` : tip;
}

/** The lines the table shows: all of them, or only the stacks that still need a count. */
export const shownLines = (r: AppraisalResult, onlyNeedCount: boolean): AppraisalLine[] =>
  onlyNeedCount ? r.lines.filter(needsCount) : r.lines;

export interface RowOptions {
  storeAdjust: number;
  /** the line hovered last: highlighted */
  last?: boolean;
  failed?: ReadonlySet<string>;
}

/**
 * One line: the item with its stats note, the count (typeable), the price each and where it comes from, what the
 * line is worth, and the List at price (typeable: a price typed there is the line's own price).
 */
export function inventoryRowHtml(l: AppraisalLine, market: MarketIndex, o: RowOptions): string {
  const e = l.entry, need = needsCount(l), list = listPrice(l, o.storeAdjust);
  const note = [l.set ? 'priced per set' : '', l.stats?.summary ?? '', l.npc != null ? `NPC pays ${fmtEach(l.npc)}` : '', l.known ? '' : 'not on the tracker'].filter(Boolean).join(' · ');
  const skip = e.ignored, tip = esc(tagTip(l, market));
  const chip = need && l.unit != null
    ? '<span class="chip need" title="Type how many you have in its Count box.">Type count</span>'
    : `<span class="chip ${l.tag}" title="${tip}">${TAG_TEXT[l.tag]}</span>`;
  return `<tr class="ap-${l.tag}${o.last ? ' last' : ''}" data-id="${esc(e.id)}">
    <td class="name"><span class="nm">${iconHtml(market, e.key, o.failed)}<span class="nm-t"><span class="nm-n">${esc(l.name)}</span>${note ? `<span class="sub">${esc(note)}</span>` : ''}</span></span></td>
    <td class="n"><input class="cellinput qty${need ? ' need' : ''}" data-id="${esc(e.id)}" data-field="qty" value="${fmt(e.qty)}" inputmode="numeric" aria-label="${l.set ? 'Sets' : 'Count'} of ${esc(l.name)}"></td>
    <td class="n">${l.unit == null ? '–' : fmtEach(l.unit)}${l.src ? `<span class="sub">${SRC_TEXT[l.src]}</span>` : ''}</td>
    <td class="n"${l.tag === 'ignored' ? '' : ` title="${tip}"`}>${l.total == null ? '–' : fmt(l.total)}${need && l.tag === 'rough' ? '<span class="sub rough">rough</span>' : ''}</td>
    <td class="n"><input class="cellinput list" data-id="${esc(e.id)}" data-field="price" value="${list == null ? '' : fmt(list)}" placeholder="price?" inputmode="numeric" aria-label="List ${esc(l.name)} at, each" title="What to type in your store, each. Type your own price to use it for this item."></td>
    <td>${chip}</td>
    <td class="acts"><button class="x" data-id="${esc(e.id)}" data-act="skip" aria-pressed="${skip ? 'true' : 'false'}" aria-label="${skip ? 'Count' : 'Skip'} ${esc(l.name)}" title="${skip ? 'Count it again' : 'Leave it out of the worth'}">${skip ? '↺' : '⊘'}</button><button class="x" data-id="${esc(e.id)}" data-act="del" aria-label="Remove ${esc(l.name)}" title="Remove">×</button></td>
  </tr>`;
}

/** The table's body: the lines shown, in the order they were added, the one hovered last highlighted. */
export function inventoryRowsHtml(lines: readonly AppraisalLine[], market: MarketIndex, o: { storeAdjust: number; lastId: string | null; failed?: ReadonlySet<string> }): string {
  return lines.map((l) => inventoryRowHtml(l, market, { storeAdjust: o.storeAdjust, last: l.entry.id === o.lastId, failed: o.failed })).join('');
}

/** The two totals, and the small line under them saying what is left out and how many prices are rough. */
export interface InventoryTotals { worth: string; store: string; left: string }

export function inventoryTotals(r: AppraisalResult, storeAdjust: number): InventoryTotals {
  const rough = r.lines.filter((l) => l.tag === 'rough').length;
  const left = [
    r.unpriced ? `${plural(r.unpriced, 'item', 'items')} not counted: no price` : '',
    r.ignored ? `${fmt(r.ignored)} skipped` : '',
    rough ? `${plural(rough, 'price is', 'prices are')} rough` : '',
  ].filter(Boolean).join(' · ');
  return { worth: fmt(r.total), store: fmt(storeTotal(r, storeAdjust)), left };
}

/**
 * The words in the view's head: "12 items · 2 need a count · 1 has no price". `need` is the label of the button
 * that shows only those stacks, null when there are none.
 */
export interface InventoryMeta { items: string; need: string | null; noPrice: string }

export function inventoryMeta(r: AppraisalResult): InventoryMeta {
  if (!r.kinds && !r.ignored) return { items: 'No items yet', need: null, noPrice: '' };
  const need = r.lines.filter(needsCount).length;
  return {
    items: plural(r.kinds, 'item', 'items'),
    need: need ? `${fmt(need)} need${need === 1 ? 's' : ''} a count` : null,
    noPrice: r.unpriced ? `${fmt(r.unpriced)} ${r.unpriced === 1 ? 'has' : 'have'} no price` : '',
  };
}

/** The offer for everything at once, in words: "You'd ask 296,998". */
export const offerAsk = (r: AppraisalResult): string => `You'd ask ${fmt(r.quote)}`;

/** What the Inventory view's Get started steps are worked out from. */
export interface InventorySetupState {
  /** market prices loaded */
  prices: number;
  capturing: boolean;
  /** items in the list */
  items: number;
}

/** The Inventory view's Get started steps. Capture counts as started once you have an item. */
export function inventorySteps(s: InventorySetupState, act: { openPrices(): void; startCapture(): void }): SetupStep[] {
  const items = s.items > 0;
  return [
    { label: 'Load market prices', done: s.prices > 0, action: { label: 'Go to Prices', run: act.openPrices } },
    { label: 'Start capture', done: s.capturing || items, action: { label: 'Start capture', run: act.startCapture } },
    { label: 'Press Scan my items and point at your items', done: items },
  ];
}

/** What the overlay shows of your items: the line hovered last (if it is still there), the worth and how many items. */
export function inventoryGlance(r: AppraisalResult, o: { lastId: string | null; storeAdjust: number; market: MarketIndex; hint: string }): InventoryGlance {
  const l = o.lastId == null ? undefined : r.lines.find((x) => x.entry.id === o.lastId);
  const last = l
    ? { key: l.entry.key, name: l.name, listAt: listPrice(l, o.storeAdjust), unit: l.unit, priceLabel: MODE_LABEL[r.mode], sales: o.market.get(l.entry.key)?.s ?? null }
    : null;
  return { last, worth: r.total, items: r.kinds, hint: o.hint };
}
