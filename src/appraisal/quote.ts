import { fmt } from '../lib/format';
import { APPRAISAL_MODES, type AppraisalResult } from './appraise';

const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** One line for the game's chat: "5 kinds / 12 items = 512,100 mesos (1 not priced)". */
export function quoteShort(r: AppraisalResult): string {
  if (!r.kinds) return 'Nothing to appraise yet';
  return `${plural(r.kinds, 'kind', 'kinds')} / ${plural(r.items, 'item', 'items')} = ${fmt(r.quote)} mesos`
    + (r.unpriced ? ` (${r.unpriced} not priced)` : '');
}

/** The full list, one line per item, for pasting somewhere with room. */
export function quoteFull(r: AppraisalResult): string {
  const counted = r.lines.filter((l) => l.tag !== 'ignored');
  if (!counted.length) return quoteShort(r);
  const head = `Appraisal (${APPRAISAL_MODES[r.mode].label.toLowerCase()} prices${r.bulk === 100 ? '' : `, offer ${r.bulk}%`})`;
  const rows = counted.map((l) => `${l.name} ×${fmt(l.entry.qty)} = ${l.total == null ? 'not priced' : fmt(l.total)}`);
  const tail = `Total ${fmt(r.total)}` + (r.bulk === 100 ? '' : ` · offer ${r.bulk}% = ${fmt(r.quote)}`);
  return [head, ...rows, tail].join('\n');
}
