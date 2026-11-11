import { equipFact, type Engine } from '../engine';
import type { AppraisalEntry, AppraisalMode, StatValue, UsualSource } from '../lib/types';
import { isRough, isSetItem, npcSellPrice } from '../market/marketIndex';
import { usualPrice } from '../pricing/evaluate';
import { hasStats, statValue } from '../tooltip/statValue';
import { isEquipItem } from './entries';

/** The two prices an item can be valued at, as the page names them: the stored values stay 'fair' and 'greedy'. */
export const MODE_LABEL: Record<AppraisalMode, string> = { fair: 'Market', greedy: 'Asking' };

/** `line` is a price typed on that line of the appraisal; `npc` is what an NPC pays for it, the least it is worth. */
export type LineSource = UsualSource | 'line' | 'npc';
/** priced: counted; rough: counted, but from fewer than 5 sales or wildly varying ones; unpriced and ignored: not counted. */
export type LineTag = 'priced' | 'rough' | 'unpriced' | 'ignored';

export interface AppraisalLine {
  entry: AppraisalEntry;
  /** the tracker's spelling when the item is known */
  name: string;
  known: boolean;
  /** throwing stars and bullets: one item holding a count, priced per set */
  set: boolean;
  /** one item (a weapon, an armour piece), not a stack */
  equip: boolean;
  /** price each (per set for sets), with any stats applied */
  unit: number | null;
  /** what an NPC pays for one, when its shop price is known */
  npc: number | null;
  src: LineSource | null;
  stats: StatValue | null;
  total: number | null;
  tag: LineTag;
}

export interface AppraisalResult {
  mode: AppraisalMode;
  lines: AppraisalLine[];
  /** priced and rough lines together */
  total: number;
  /** the part of the total that is rough */
  rough: number;
  /** lines with no price at all */
  unpriced: number;
  ignored: number;
  /** lines and stacks counted (ignored ones are not) */
  kinds: number;
  items: number;
}

/** One line: what each costs in this mode, what that makes for the stack, and how sure the price is. */
export function appraiseEntry(e: Engine, entry: AppraisalEntry, mode: AppraisalMode): AppraisalLine {
  const it = e.book.items[entry.key], mk = e.market.get(entry.key);
  const name = mk ? mk.n : entry.name;
  const set = isSetItem(mk, name);
  const typed = entry.price && entry.price > 0 ? entry.price : null;
  const u = typed != null ? { value: typed, src: 'line' as const, rough: false } : usualPrice(it, mk, e.settings, e.now(), mode);
  // stats read from a hover tooltip scale an equip's price, and settle "copies sell for very different prices", as in the shop
  const stats = entry.tip && typed == null
    ? statValue(entry.tip, { statPct: e.settings.statPct, slotWorth: e.settings.slotWorth, maxSlotsSeen: it?.maxSlots, fact: equipFact(e, entry.key) })
    : null;
  let unit = u ? u.value * (stats?.mult ?? 1) : null, src: LineSource | null = u?.src ?? null;
  let rough = !!u?.rough && isRough(mk, hasStats(entry.tip));
  // an NPC pays its price for any copy, so nothing is worth less: with no market price it is the price, and it lifts
  // a lower one. A price typed on the line stays as typed.
  const npc = set ? null : npcSellPrice(mk, e.settings.npcRatio);
  if (typed == null && npc != null && (unit == null || unit < npc)) { unit = npc; src = 'npc'; rough = true; }
  const total = unit == null ? null : Math.round(unit * entry.qty);
  const tag: LineTag = entry.ignored ? 'ignored' : unit == null ? 'unpriced' : rough ? 'rough' : 'priced';
  return { entry, name, known: e.market.knownName(entry.key) != null, set, equip: isEquipItem(e, entry.key, entry.tip), unit, npc, src, stats, total, tag };
}

/** The whole appraisal: every line priced in `mode`, and the total. */
export function appraise(e: Engine, entries: readonly AppraisalEntry[], mode: AppraisalMode): AppraisalResult {
  const lines = entries.map((x) => appraiseEntry(e, x, mode));
  let total = 0, rough = 0, unpriced = 0, ignored = 0, kinds = 0, items = 0;
  for (const l of lines) {
    if (l.tag === 'ignored') { ignored++; continue; }
    kinds++;
    items += l.entry.qty;
    if (l.tag === 'unpriced') { unpriced++; continue; }
    total += l.total ?? 0;
    if (l.tag === 'rough') rough += l.total ?? 0;
  }
  return { mode, lines, total, rough, unpriced, ignored, kinds, items };
}

/**
 * What to type when you put the line in your store, each: a price typed on the line as it is, else the line's
 * price each moved by `storeAdjust` percent, in whole mesos (never under 1). A line with no price has none.
 */
export function listPrice(line: AppraisalLine, storeAdjust: number): number | null {
  if (line.unit == null) return null;
  if (line.src === 'line') return Math.round(line.unit);
  return Math.max(1, Math.round(line.unit * (1 + storeAdjust / 100)));
}

/** What everything counted comes to at its List at price: "In your store". Skipped lines and lines with no price add nothing. */
export function storeTotal(r: AppraisalResult, storeAdjust: number): number {
  let sum = 0;
  for (const l of r.lines) {
    const each = l.tag === 'ignored' ? null : listPrice(l, storeAdjust);
    if (each != null) sum += each * l.entry.qty;
  }
  return sum;
}

/**
 * A stack whose count you still have to type: still the 1 it started at and not typed by you, or holding a hovered
 * slot whose number was not read. It shows under "need a count". Equips are one item each; skipped lines don't count.
 */
export const needsCount = (l: AppraisalLine): boolean =>
  l.tag !== 'ignored' && !l.equip && (!!l.entry.unsure || (l.entry.qty === 1 && !l.entry.counted));
