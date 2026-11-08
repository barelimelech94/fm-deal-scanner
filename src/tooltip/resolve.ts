import type { Engine } from '../engine';
import { resolveKey } from '../market/matching';
import type { ResolveName } from './parseTooltip';

/**
 * Names read from a tooltip: the item they mean, and its real spelling when it is a known one. A tooltip is
 * read through a see-through box, so a letter or two of a long name can come out wrong ("chen Bamboo Hat"):
 * one more misread letter is allowed than in a shop listing, still never between two different items.
 */
export const tooltipResolver = (e: Engine): ResolveName => (name) => {
  const key = resolveKey({ market: e.market, book: e.book }, name, false, 1);
  return { key, known: e.market.knownName(key) };
};
