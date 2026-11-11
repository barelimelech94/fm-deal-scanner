import { fmt } from '../lib/format';
import { listPrice, type AppraisalResult } from './appraise';

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
