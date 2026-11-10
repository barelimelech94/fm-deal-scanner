import type { EquipFact, EquipFacts } from './market/equipFacts';
import type { MarketIndex } from './market/marketIndex';
import type { PriceBook, Settings } from './lib/types';

/** Everything the pricing logic reads. Passed explicitly so it can be tested without a browser. */
export interface Engine {
  market: MarketIndex;
  /** the game data's facts about equips, by item id; empty when they aren't loaded */
  facts: EquipFacts;
  book: PriceBook;
  settings: Settings;
  now: () => number;
}

/** What the game data says about an item, found by its id (the tracker's, else the game's item list's). */
export function equipFact(e: Engine, key: string): EquipFact | undefined {
  const id = e.market.iconId(key);
  return id == null ? undefined : e.facts.get(id);
}
