import { DAY } from '../lib/format';
import { quantile } from '../lib/text';
import type { BookItem, Listing, PriceBook, Sighting } from '../lib/types';
import { findKey } from '../market/matching';
import { isSetItem, type MarketIndex } from '../market/marketIndex';

/** Sightings older than this don't count toward the usual price. */
export const WINDOW_DAYS = 14;
/** Sightings older than this are deleted. */
export const KEEP_DAYS = 30;
const MAX_SIGHTINGS = 400;

export interface SightingStats { n: number; median: number | null; q25: number | null; q75: number | null; low: number | null; last: number | null }

export function sightingStats(it: BookItem | null | undefined, now: number): SightingStats {
  if (!it) return { n: 0, median: null, q25: null, q75: null, low: null, last: null };
  const cut = now - WINDOW_DAYS * DAY;
  const recent = (it.s ?? []).filter((e) => e[0] >= cut);
  const xs = recent.map((e) => e[1]).sort((a, b) => a - b);
  return {
    n: xs.length,
    median: quantile(xs, 0.5),
    q25: quantile(xs, 0.25),
    q75: quantile(xs, 0.75),
    low: xs[0] ?? null,
    last: recent.length ? Math.max(...recent.map((e) => e[0])) : null,
  };
}

export const newItem = (name: string): BookItem => ({ name, manualRef: null, buyUnder: null, s: [] });

/** Records a listing seen in a shop. The same price seen again within 5 minutes is one sighting. */
export function logSighting(book: PriceBook, row: Listing, displayName: string, now: number): void {
  const it = book.items[row.key] ?? (book.items[row.key] = newItem(displayName));
  const dup = it.s.some((e) => now - e[0] < 5 * 60e3 && e[1] === row.unit && e[2] === row.units);
  if (!dup) it.s.push([now, row.unit, row.units]);
  if (it.s.length > MAX_SIGHTINGS) it.s.splice(0, it.s.length - MAX_SIGHTINGS);
}

export function pruneOld(book: PriceBook, now: number): void {
  const cut = now - KEEP_DAYS * DAY;
  for (const it of Object.values(book.items)) it.s = (it.s ?? []).filter((e) => e[0] >= cut);
}

function mergeSightings(to: BookItem, from: readonly Sighting[]): void {
  const seen = new Set(to.s.map((x) => x.join('|')));
  for (const x of from) if (!seen.has(x.join('|'))) to.s.push(x);
  to.s.sort((a, b) => a[0] - b[0]);
  if (to.s.length > MAX_SIGHTINGS) to.s.splice(0, to.s.length - MAX_SIGHTINGS);
}

/**
 * Sightings saved under a misread or cut-off name move onto the tracker's name for that item,
 * so the price book doesn't list it twice. Typed prices come along. Returns how many moved.
 */
export function mergeIntoMarket(book: PriceBook, market: MarketIndex): number {
  if (!market.keys.length) return 0;
  let moved = 0;
  for (const k of Object.keys(book.items)) {
    const from = book.items[k]!;
    const pk = (x: string) => market.primaryKey(x);
    const target = market.has(k) ? pk(k) : findKey(k, /(\.\.|…)$/.test(from.name || ''), market.keys, pk);
    if (!target || target === k) continue;
    const name = market.get(target)?.n ?? from.name;
    const to = book.items[target] ?? (book.items[target] = newItem(name));
    mergeSightings(to, from.s ?? []);
    to.manualRef = to.manualRef || from.manualRef || null;
    to.buyUnder = to.buyUnder || from.buyUnder || null;
    to.name = name;
    delete book.items[k];
    moved++;
  }
  return moved;
}

/** Old sightings of stars divided the set's price by its count; puts them back to the price per set. */
export function fixSetSightings(book: PriceBook, market: MarketIndex): number {
  let n = 0;
  for (const [k, it] of Object.entries(book.items)) {
    if (!isSetItem(market.get(k), it.name)) continue;
    it.s = (it.s ?? []).map((e): Sighting => {
      if (e[2] > 1) { n++; return [e[0], Math.round(e[1] * e[2]), 1]; }
      return e;
    });
  }
  return n;
}

/** Merges a backup file's price book into this one. Returns how many items it held. */
export function mergeBackup(book: PriceBook, incoming: PriceBook): number {
  for (const [k, it] of Object.entries(incoming.items)) {
    const cur = book.items[k];
    if (!cur) { book.items[k] = { ...it, s: [...(it.s ?? [])] }; continue; }
    mergeSightings(cur, it.s ?? []);
    cur.manualRef = cur.manualRef || it.manualRef;
    cur.buyUnder = cur.buyUnder || it.buyUnder;
  }
  return Object.keys(incoming.items).length;
}

export function isPriceBook(v: unknown): v is PriceBook {
  return !!v && typeof v === 'object' && !!(v as PriceBook).items && typeof (v as PriceBook).items === 'object';
}
