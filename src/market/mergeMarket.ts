import type { MarketData, MarketItem } from '../lib/types';

/**
 * Adds a newly loaded tracker page to the prices already kept. The tracker shows its table a page at a time,
 * so each saved file holds only some of the items: loading one must add to the rest, not replace them.
 *
 * For the same world (ignoring case), or no world named on either: every item of both, by tracker id. The new
 * page's rows win; a row only the old data has is kept, with `t` saying when its price was taken (its own `t`,
 * else the old data's `asOf`). `asOf` and `updated` are the new page's. For another world the new page stands
 * alone. Neither argument is changed.
 */
export function mergeMarket(prev: MarketData | null, next: MarketData): MarketData {
  if (!prev || (prev.world || '').toLowerCase() !== (next.world || '').toLowerCase()) return next;
  const items = new Map<string, MarketItem>();
  for (const it of prev.items) items.set(it.id, { ...it, t: it.t ?? prev.asOf });
  for (const it of next.items) items.set(it.id, it);
  return { ...next, items: [...items.values()] };
}
