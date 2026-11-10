import type { StatLine, StatValue, TooltipRead } from '../lib/types';
import type { EquipFact } from '../market/equipFacts';
import type { StatLabel } from './parseTooltip';

/**
 * Upgrade slots an item starts with, by its type, when the game data doesn't say. The most ever seen
 * for that item wins if higher.
 */
const SLOT_TYPES: readonly [RegExp, number][] = [
  [/overall/i, 10],
  [/glove|shoe|cape|earring/i, 5],
  [/sword|axe|blunt|mace|polearm|spear|bow|claw|dagger|wand|staff|knuckle|gun|shield|hat|helm|top|bottom/i, 7],
];

export const slotsForType = (type: string): number => SLOT_TYPES.find(([re]) => re.test(type))?.[1] ?? 0;

/**
 * Whether stats were read off this tooltip: its stat lines or its upgrade slots. Equips carry them; scrolls,
 * potions and the like do not, and stack.
 */
export const hasStats = (t: TooltipRead | null | undefined): boolean => !!t && (t.stats.length > 0 || t.remaining != null);

/** A copy is known by its stats: hovering the same copy again reads the same. */
export const statSig = (t: TooltipRead): string => t.stats.map((x) => `${x.label}:${x.total}/${x.base}`).join(';') + `|${t.remaining ?? ''}`;

/**
 * A stat line against the item's real base (0 for a stat it has none of). A bracket that disagrees with
 * the total and gives the real base was printed by the game as base ± n: that is the total.
 */
function againstFact(x: StatLine, fact: EquipFact): StatLine {
  const base = fact.base[x.label as StatLabel] ?? 0;
  const total = x.printed && x.printed.base === base ? base + x.printed.diff : x.total;
  return { ...x, total, base, delta: total - base };
}

/**
 * What the stats do to the value: each point above or below base moves it by `statPct` %, and each
 * used upgrade slot costs `slotWorth` points, since a clean item can still be scrolled.
 * The tracker has no prices by stats, so this is a rule of thumb the settings tune.
 * With the game data's `fact` about the item, its slots and base stats come from there; without it,
 * from the tooltip, its type and the most slots ever seen.
 */
export function statValue(t: TooltipRead, opts: { statPct: number; slotWorth: number; maxSlotsSeen?: number; fact?: EquipFact }): StatValue {
  const { fact } = opts;
  const maxSlots = fact?.slots ?? Math.max(slotsForType(t.type), opts.maxSlotsSeen ?? 0, t.remaining ?? 0);
  const stats = fact ? t.stats.map((x) => againstFact(x, fact)) : t.stats;
  const used = t.remaining != null && maxSlots ? Math.max(0, maxSlots - t.remaining) : 0;
  const points = stats.reduce((a, x) => a + x.delta * x.weight, 0);
  const eff = points - used * opts.slotWorth;
  const mult = Math.max(0.25, Math.min(3, 1 + (eff * opts.statPct) / 100));
  const moved = stats.filter((x) => x.delta).sort((a, b) => b.weight - a.weight);
  const parts = moved.slice(0, 3).map((x) => `${x.delta > 0 ? '+' : '−'}${Math.abs(x.delta)} ${x.label}`);
  const slots = t.remaining == null ? '' : used ? `${used} of ${maxSlots} slots used` : `${t.remaining} slots left`;
  const summary = [parts.length ? parts.join(', ') : 'average stats', slots].filter(Boolean).join(', ');
  return { mult, summary, points, used };
}
