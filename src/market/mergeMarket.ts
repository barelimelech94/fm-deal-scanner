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

const sameWorld = (a: MarketData, b: MarketData): boolean => (a.world || '').toLowerCase() === (b.world || '').toLowerCase();

/** What a load of several tracker pages made of the prices kept. */
export interface MarketLoad {
  data: MarketData;
  /** prices this load added or updated */
  changed: number;
  /** the world whose prices were dropped because a page was for another one; null when none were */
  replaced: string | null;
}

/**
 * Several tracker pages loaded at once, added to the prices kept (`prev`) with `mergeMarket`, oldest page first
 * by its own "as of" time, so the newest price of an item wins.
 */
export function mergeMarketPages(prev: MarketData | null, pages: readonly MarketData[]): MarketLoad {
  let data = prev, replaced: string | null = null;
  const changed = new Set<string>();
  for (const page of [...pages].sort((a, b) => a.asOf - b.asOf)) {
    if (data?.items.length && !sameWorld(data, page)) { replaced = data.world; changed.clear(); }
    data = mergeMarket(data, page);
    for (const it of page.items) if (it.p) changed.add(it.id);
  }
  if (!data) throw new Error('no pages to load');
  return { data, changed: changed.size, replaced };
}
