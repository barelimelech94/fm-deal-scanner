import type { Engine } from '../../src/engine';
import type { MarketItem } from '../../src/lib/types';
import { catalogOf, engine } from './market';

/**
 * The items on the hover screenshots (tests/fixtures/img/appraisal), priced as the tracker had them on
 * Nov 7 2026. The ids are made up, but in the game's ranges (equips are 1,000,000 to 1,999,999), so equips
 * and stacks are told apart as in the game.
 */
export const HOVER_ITEMS: MarketItem[] = ([
  ['Overall Armor LUK Scroll: Greater', 'Scrolls', 27499, 9916, 2040000], ['Topwear DEF Scroll: Greater', 'Scrolls', 1499, 8747, 2040001],
  ['Weighted Earrings', 'Equips', 5617, 11362, 1000002], ['Red Cross Earrings', 'Equips', 4500, 2782, 1000003], ['Yellow Square', 'Equips', 4050, 4498, 1000004],
  ['Blue Bamboo Hat', 'Equips', 2000, 4320, 1000005], ['Green Bamboo Hat', 'Equips', 2000, 3377, 1000006], ['Lemona', 'Equips', 2000, 2075, 1000007],
  ['Red Potion', 'Use', 40, 10354, 2000008], ['Leaf', 'Etc', 30, 8213, 4000009],
] as [string, string, number, number, number][]).map(([n, c, p, s, id]) => ({ id: `basil:0${id}`, n, c, p, s, d: 0, w: 0 }));

/** The game's id of one of those items. */
export const hoverId = (it: MarketItem): number => Number(it.id.split(':')[1]);

/** An engine that knows those items, from the tracker and from the game's own item list. */
export function hoverEngine(tracker = true): Engine {
  const e = engine({ items: tracker ? HOVER_ITEMS : [] });
  e.market = e.market.withCatalog(catalogOf(HOVER_ITEMS.map((it): [number, string] => [hoverId(it), it.n])));
  return e;
}
