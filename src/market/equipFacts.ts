import type { StatLabel } from '../tooltip/parseTooltip';

/** What the game data says about an equip: the upgrade slots it starts with, and its base stats. */
export interface EquipFact {
  /** null when the game data gives no count */
  slots: number | null;
  /** by the label its tooltip line gets; a stat the item has no base for is left out */
  base: Partial<Record<StatLabel, number>>;
  /** another non-cash equip has this one's name and other facts: found by its name alone, it may be the other one */
  ambiguous?: true;
}

/** Equip facts by item id. Empty when the file is missing: stats are then read from the tooltip alone. */
export type EquipFacts = ReadonlyMap<number, EquipFact>;

/** One equip in the served file: [id, upgrade slots, base stats by the game's names]. */
export type EquipRow = [number, number | null, Record<string, number>];

/**
 * The file the site serves: written at build time by scripts/fetch-items.ts. `ambiguous` lists the ids whose name
 * another non-cash equip shares with other slots or base stats; a file written before it existed has none.
 */
export interface EquipFile { source: string; fetched: string; items: EquipRow[]; ambiguous?: number[] }

/** The game's stat names (its `inc…` fields without the prefix) and the labels the tooltip lines get. */
export const GAME_STATS: Readonly<Record<string, StatLabel>> = {
  WAT: 'att', MAD: 'magic att', STR: 'STR', DEX: 'DEX', INT: 'INT', LUK: 'LUK', ACC: 'accuracy', EVA: 'avoid',
  Speed: 'speed', Jump: 'jump', PDD: 'weapon def', MDD: 'magic def', CRT: 'crit rate', CRD: 'crit dmg', MHP: 'HP', MMP: 'MP',
};

/** Equips are numbered 1,000,000 to 1,999,999. */
export const isEquipId = (id: number): boolean => Number.isInteger(id) && id >= 1_000_000 && id <= 1_999_999;

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

export function parseEquipFacts(j: unknown): EquipFacts {
  const { items, ambiguous } = (j as Partial<EquipFile> | null) ?? {};
  const out = new Map<number, EquipFact>();
  if (!Array.isArray(items)) return out;
  for (const row of items) {
    if (!Array.isArray(row)) continue;
    const [id, slots, stats] = row as unknown[];
    if (typeof id !== 'number' || !isEquipId(id) || out.has(id)) continue;
    const base: EquipFact['base'] = {};
    if (stats && typeof stats === 'object') {
      for (const [k, v] of Object.entries(stats)) {
        const label = Object.hasOwn(GAME_STATS, k) ? GAME_STATS[k] : undefined;
        if (label && typeof v === 'number' && Number.isFinite(v)) base[label] = v;
      }
    }
    out.set(id, { slots: isCount(slots) ? slots : null, base });
  }
  if (Array.isArray(ambiguous)) {
    for (const id of ambiguous as unknown[]) { const f = typeof id === 'number' ? out.get(id) : undefined; if (f) f.ambiguous = true; }
  }
  return out;
}

/** The facts the site serves; empty when the file is missing or the request fails. */
export async function loadEquipFacts(url: string, fetcher: typeof fetch = fetch): Promise<EquipFacts> {
  try {
    const r = await fetcher(url);
    return r.ok ? parseEquipFacts(await r.json()) : new Map();
  } catch { return new Map(); }
}
