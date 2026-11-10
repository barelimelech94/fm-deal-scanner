import type { Engine } from '../../src/engine';
import { DEFAULT_SETTINGS, type MarketItem, type PriceBook, type Settings } from '../../src/lib/types';
import { parseCatalog, type Catalog } from '../../src/market/catalog';
import { parseEquipFacts, type EquipFacts } from '../../src/market/equipFacts';
import { MarketIndex } from '../../src/market/marketIndex';
import EQUIPS_SAMPLE from '../fixtures/equips.sample.json' with { type: 'json' };

/** Synthetic tracker items covering the cases the logic distinguishes. */
export const ITEMS: MarketItem[] = [
  { id: 'basil:01302012', n: 'Traus', c: 'Weapons', p: 55000, s: 94, d: 0.02, w: -0.05, e: '⚔️' },
  { id: 'basil:01442005', n: 'Axe Pole Arm', c: 'Weapons', p: 15000, s: 2499, d: 0, w: 0.1 },
  { id: 'basil:01472013', n: 'Dark Guardian', c: 'Weapons', p: 71000, s: 300, d: null, w: null },
  { id: 'basil:02040803', n: 'Gloves Attack Scroll: Chaos', a: 'Gloves Attack Scroll', c: 'Scrolls', p: 1844444, s: 4, d: null, w: null, f: 'l' },
  { id: 'basil:02040801', n: 'Gloves Attack Scroll: Intermediate', a: 'Gloves Attack Scroll', c: 'Scrolls', p: 1099999, s: 2252, d: 0.1, w: 0.39 },
  { id: 'basil:02040802', n: 'Gloves Attack Scroll: Greater', a: 'Gloves Attack Scroll', c: 'Scrolls', p: 430000, s: 120, d: null, w: null },
  { id: 'basil:02070006', n: 'Wolbi Throwing Stars', c: 'Stars', p: 2499, s: 7359, d: 0, w: 0 },
  { id: 'basil:02070004', n: 'Tobi Throwing Stars', c: 'Stars', p: 1850000, s: 198, d: 0, w: 0 },
  { id: 'basil:02060000', n: 'Arrows for Bows', c: 'Use', p: 5, s: 900, d: 0, w: 0 },
  { id: 'basil:01332013', n: 'Korean Fan', c: 'Weapons', p: 68888, s: 40, d: 0, w: 0, f: 'w' },
  { id: 'basil:02049100', n: 'AP Reset Scroll', c: 'Scrolls', p: 5000000, s: 30, d: 0, w: 0 },
  { id: 'basil:02049101', n: 'SP Reset Scroll', c: 'Scrolls', p: 4000000, s: 30, d: 0, w: 0 },
  { id: 'basil:01082003', n: 'Lemona', c: 'Equips', p: 21000, s: 50, d: 0, w: 0 },
  { id: 'basil:01072075', n: 'Bronze Chain Boots', c: 'Equips', p: 12000, s: 60, d: 0, w: 0 },
  { id: 'basil:01102000', n: 'Unsold Cape', c: 'Equips', p: null, s: 0, d: null, w: null },
  { id: 'cash:01702048', n: 'Soft Chocolate Fondue Scepter', c: 'Cash Shop', p: 2849999, s: 12, d: 0, w: 0 },
];

export const market = (items: MarketItem[] = ITEMS) => new MarketIndex({ world: 'Windia', updated: 'Nov 1, 2:30 PM', asOf: 0, items });

/** The game data's list of items, as the site loads it: [id, name] per item. */
export const catalogOf = (items: [number, string][]): Catalog => parseCatalog({ items });

/** Every test item as game data, plus a few the tracker doesn't list. */
export const CATALOG = catalogOf([
  ...ITEMS.map((it): [number, string] => [Number(it.id.split(':')[1]), it.n]),
  [1082002, 'Work Gloves'], [1302000, 'Sword'], [1040002, 'White Undershirt'], [1442000, 'Axe'],
]);

/** The game data's facts about a few equips (tests/fixtures/equips.sample.json), as the site loads them. */
export const FACTS: EquipFacts = parseEquipFacts(EQUIPS_SAMPLE);

export const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

export function engine(over: { book?: PriceBook; settings?: Partial<Settings>; items?: MarketItem[]; now?: () => number; facts?: EquipFacts } = {}): Engine {
  return {
    market: market(over.items),
    facts: over.facts ?? new Map(),
    book: over.book ?? { items: {} },
    settings: { ...DEFAULT_SETTINGS, ...over.settings },
    now: over.now ?? (() => NOW),
  };
}
