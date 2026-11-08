import type { Engine } from '../../src/engine';
import type { MarketItem } from '../../src/lib/types';
import { catalogOf, engine } from './market';

/**
 * The items on the hover screenshots (tests/fixtures/img/appraisal), priced as the tracker had them on
 * Nov 7 2026. The ids are made up: only the names and prices matter here.
 */
export const HOVER_ITEMS: MarketItem[] = ([
  ['Overall Armor LUK Scroll: Greater', 'Scrolls', 27499, 9916], ['Topwear DEF Scroll: Greater', 'Scrolls', 1499, 8747],
  ['Weighted Earrings', 'Equips', 5617, 11362], ['Red Cross Earrings', 'Equips', 4500, 2782], ['Yellow Square', 'Equips', 4050, 4498],
  ['Blue Bamboo Hat', 'Equips', 2000, 4320], ['Green Bamboo Hat', 'Equips', 2000, 3377], ['Lemona', 'Equips', 2000, 2075],
  ['Red Potion', 'Use', 40, 10354], ['Leaf', 'Etc', 30, 8213],
] as [string, string, number, number][]).map(([n, c, p, s], i) => ({ id: `basil:0${1000000 + i}`, n, c, p, s, d: 0, w: 0 }));

/** An engine that knows those items, from the tracker and from the game's own item list. */
export function hoverEngine(tracker = true): Engine {
  const e = engine({ items: tracker ? HOVER_ITEMS : [] });
  e.market = e.market.withCatalog(catalogOf(HOVER_ITEMS.map((it, i): [number, string] => [1000000 + i, it.n])));
  return e;
}
