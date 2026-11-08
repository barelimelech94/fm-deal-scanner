import { lev, norm } from '../lib/text';
import type { PriceBook } from '../lib/types';
import type { MarketIndex } from './marketIndex';

export interface Catalog { market: MarketIndex; book: PriceBook }

/** A short-name key maps to the item's full-name key, unless the price book already files it there. */
export function canon(cat: Catalog, k: string): string {
  const m = cat.market.get(k);
  return !m || cat.book.items[k] ? k : norm(m.n);
}

/**
 * The one item a name means: a unique prefix for a cut-off name, or a near-exact spelling.
 * Two different items equally close ("AP Reset Scroll" / "SP Reset Scroll") means no match.
 */
export function findKey(k: string, truncated: boolean, keys: readonly string[], pick: (k: string) => string, extra = 0): string | null {
  if (truncated) {
    const hits = new Set(keys.filter((x) => x.startsWith(k)).map(pick));
    if (hits.size === 1) return [...hits][0]!;
  }
  // `extra` spellings more are allowed in names of 7 letters or more, for text read through a see-through box
  const tol = (k.length >= 14 ? 2 : k.length >= 7 ? 1 : 0) + (k.length >= 7 ? extra : 0);
  let best: string | null = null, bd = Infinity, tie = false;
  for (const x of keys) {
    if (Math.abs(x.length - k.length) > tol) continue;
    const d = lev(x, k);
    if (d < bd) { bd = d; best = x; tie = false; }
    else if (d === bd && best != null && pick(x) !== pick(best)) tie = true;
  }
  return best != null && bd <= tol && !tie ? pick(best) : null;
}

/**
 * The key a name read off the screen is filed under: your price book's or the tracker's spelling,
 * then any real item's from the game data (which also lists what the tracker doesn't), else as read.
 */
export function resolveKey(cat: Catalog, name: string, truncated: boolean, extra = 0): string {
  const k = norm(name);
  if (cat.book.items[k]) return k;
  if (cat.market.has(k)) return canon(cat, k);
  // an exact real name; a cut-off name can't be one
  if (!truncated && cat.market.catalog.has(k)) return k;
  const keys = [...new Set([...Object.keys(cat.book.items), ...cat.market.keys])];
  return findKey(k, truncated, keys, (x) => canon(cat, x), extra) ?? cat.market.nearestInCatalog(k, truncated, extra) ?? k;
}
