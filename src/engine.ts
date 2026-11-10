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

/**
 * What the game data says about an item, found by its id: the tracker's, else the game's item list's for its name.
 * That list keeps one id per name, so an id it gives for a name another equip shares with other facts gives none:
 * the stats are then read as they are without the game data.
 */
export function equipFact(e: Engine, key: string): EquipFact | undefined {
  const tracked = e.market.trackerId(key);
  if (tracked != null) return e.facts.get(tracked);
  const id = e.market.catalog.get(key)?.id;
  const fact = id == null ? undefined : e.facts.get(id);
  return fact?.ambiguous ? undefined : fact;
}
