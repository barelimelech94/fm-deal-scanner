import { fmt } from '../lib/format';
import { listPrice, type AppraisalResult } from './appraise';

const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** One line for the game's chat, offering everything at once: "15 items for 296,998 mesos (1 not priced)". */
export function offerText(r: AppraisalResult): string {
  if (!r.kinds) return 'No items yet';
  return `${plural(r.items, 'item', 'items')} for ${fmt(r.quote)} mesos` + (r.unpriced ? ` (${r.unpriced} not priced)` : '');
}

/**
 * What to type into your store, one line per item in the order they were added: "Lemona ×1: 22,050". Skipped
 * items are left out; an item with no price says so.
 */
export function storePricesText(r: AppraisalResult, storeAdjust: number): string {
  return r.lines.filter((l) => l.tag !== 'ignored').map((l) => {
    const each = listPrice(l, storeAdjust);
    return `${l.name} ×${fmt(l.entry.qty)}: ${each == null ? 'no price' : fmt(each)}`;
  }).join('\n');
}
