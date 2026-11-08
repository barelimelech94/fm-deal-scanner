import type { Engine } from '../engine';
import type { AppraisalEntry, AppraisalMode, AppraisalSortCol, StatValue, UsualSource } from '../lib/types';
import { isSetItem, npcSellPrice } from '../market/marketIndex';
import { usualPrice } from '../pricing/evaluate';
import { statValue } from '../tooltip/statValue';

/** What the appraisal's modes mean, in words, for the panel. */
export const APPRAISAL_MODES: Record<AppraisalMode, { label: string; blurb: string }> = {
  fair: { label: 'Fair', blurb: "the tracker's typical price" },
  greedy: { label: 'Greedy', blurb: "the higher of the tracker's typical price and the upper quarter of your own sightings" },
};

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
  /** the percentage of the total on offer */
  bulk: number;
  /** the total at that percentage */
  quote: number;
}

/** One line: what each costs in this mode, what that makes for the stack, and how sure the price is. */
export function appraiseEntry(e: Engine, entry: AppraisalEntry, mode: AppraisalMode): AppraisalLine {
  const it = e.book.items[entry.key], mk = e.market.get(entry.key);
  const name = mk ? mk.n : entry.name;
  const set = isSetItem(mk, name);
  const typed = entry.price && entry.price > 0 ? entry.price : null;
  const u = typed != null ? { value: typed, src: 'line' as const, rough: false } : usualPrice(it, mk, e.settings, e.now(), mode);
  // stats read from a hover tooltip scale an equip's price, and settle a rough market price, as in the shop
  const stats = entry.tip && typed == null
    ? statValue(entry.tip, { statPct: e.settings.statPct, slotWorth: e.settings.slotWorth, maxSlotsSeen: it?.maxSlots })
    : null;
  let unit = u ? u.value * (stats?.mult ?? 1) : null, src: LineSource | null = u?.src ?? null;
  let rough = !!u?.rough && !stats;
  // an NPC pays its price for any copy, so nothing is worth less: with no market price it is the price, and it lifts
  // a lower one. A price typed on the line stays as typed.
  const npc = set ? null : npcSellPrice(mk, e.settings.npcRatio);
  if (typed == null && npc != null && (unit == null || unit < npc)) { unit = npc; src = 'npc'; rough = true; }
  const total = unit == null ? null : Math.round(unit * entry.qty);
  const tag: LineTag = entry.ignored ? 'ignored' : unit == null ? 'unpriced' : rough ? 'rough' : 'priced';
  return { entry, name, known: e.market.knownName(entry.key) != null, set, unit, npc, src, stats, total, tag };
}

/** The whole appraisal: every line priced in `mode`, the total, and the offer at `bulk` percent of it. */
export function appraise(e: Engine, entries: readonly AppraisalEntry[], mode: AppraisalMode, bulk = 100): AppraisalResult {
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
  return { mode, lines, total, rough, unpriced, ignored, kinds, items, bulk, quote: Math.round((total * bulk) / 100) };
}

export interface AppraisalSort { col: AppraisalSortCol; dir: 1 | -1 }
export const AS_ADDED: AppraisalSort = { col: 'added', dir: 1 };
export const APPRAISAL_SORT_COLS: readonly AppraisalSortCol[] = ['added', 'name', 'qty', 'unit', 'total'];

/** The way a column starts when first clicked: the most valuable, the biggest stack, the dearest price first. */
const FIRST_DIR: Record<AppraisalSortCol, 1 | -1> = { added: 1, name: 1, qty: -1, unit: -1, total: -1 };

/** The sort after a click on a column: the same column flips, another starts in its natural direction. */
export const nextAppraisalSort = (cur: AppraisalSort, col: AppraisalSortCol): AppraisalSort =>
  col === cur.col ? { col, dir: (-cur.dir) as 1 | -1 } : { col, dir: FIRST_DIR[col] };

/** A saved sort, checked: anything unknown is the order the lines were added in. */
export const cleanAppraisalSort = (col: unknown, dir: unknown): AppraisalSort =>
  APPRAISAL_SORT_COLS.includes(col as AppraisalSortCol) ? { col: col as AppraisalSortCol, dir: dir === -1 ? -1 : 1 } : AS_ADDED;

const value = (l: AppraisalLine, col: AppraisalSortCol): number | string | null =>
  col === 'name' ? l.name : col === 'qty' ? l.entry.qty : col === 'unit' ? l.unit : col === 'total' ? l.total : null;

/**
 * The lines in the order asked for, as a new list. Skipped lines stay last, and so do lines with no price when
 * ordering by what they are worth (there is nothing to order them by); ties keep the order the lines were added in.
 */
export function sortLines(lines: readonly AppraisalLine[], sort: AppraisalSort = AS_ADDED): AppraisalLine[] {
  const at = new Map(lines.map((l, i) => [l, i] as const));
  const added = (a: AppraisalLine, b: AppraisalLine) => at.get(a)! - at.get(b)!;
  if (sort.col === 'added') return [...lines];
  return [...lines].sort((a, b) => {
    const skipped = (a.tag === 'ignored' ? 1 : 0) - (b.tag === 'ignored' ? 1 : 0);
    if (skipped) return skipped;
    const x = value(a, sort.col), y = value(b, sort.col);
    if (x == null || y == null) return x == null && y == null ? added(a, b) : x == null ? 1 : -1;
    const d = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return d ? d * sort.dir : added(a, b);
  });
}
