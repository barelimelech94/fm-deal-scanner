import { itemNumber } from '../icons';
import { fmtEach, pctTxt, salesTxt } from '../lib/format';
import { norm } from '../lib/text';
import type { MarketData, MarketItem } from '../lib/types';
import type { Catalog } from './catalog';
import { findKey } from './matching';

/** Looks up tracker items by their normalized name. */
export class MarketIndex {
  readonly data: MarketData;
  private readonly byKey = new Map<string, MarketItem>();
  /** keys of full names, one per item */
  readonly primary: string[] = [];
  /** every key, full names plus unique short names */
  readonly keys: string[];
  readonly priced: number;
  /** how many items have an NPC shop price */
  readonly withNpc: number;

  private catalogKeyList: string[] | null = null;
  private readonly nearest = new Map<string, string | null>();

  /** `catalog` names every item in the game, for items the tracker doesn't list. */
  constructor(data: MarketData | null, readonly catalog: Catalog = new Map()) {
    this.data = data && Array.isArray(data.items) ? data : { world: '', updated: '', asOf: 0, items: [] };
    for (const it of this.data.items) {
      const k = norm(it.n);
      if (k && !this.byKey.has(k)) { this.byKey.set(k, it); this.primary.push(k); }
    }
    // the tracker's short display name also matches, when only one item uses it
    const shortCount = new Map<string, number>();
    for (const it of this.data.items) if (it.a) { const k = norm(it.a); shortCount.set(k, (shortCount.get(k) ?? 0) + 1); }
    for (const it of this.data.items) {
      if (!it.a) continue;
      const k = norm(it.a);
      if (shortCount.get(k) === 1 && !this.byKey.has(k)) this.byKey.set(k, it);
    }
    this.keys = [...this.byKey.keys()];
    this.priced = this.data.items.filter((it) => it.p).length;
    this.withNpc = this.data.items.filter((it) => it.npc).length;
  }

  get(key: string): MarketItem | null { return this.byKey.get(key) ?? null; }
  has(key: string): boolean { return this.byKey.has(key); }
  /** the key of the item's full name, for a short-name key */
  primaryKey(key: string): string { const m = this.byKey.get(key); return m ? norm(m.n) : key; }
  get size(): number { return this.primary.length; }
  /** The item id its picture is under: the tracker's, else the game data's for that exact name. */
  iconId(key: string): number | null {
    const mk = this.byKey.get(key);
    return (mk && itemNumber(mk.id)) ?? this.catalog.get(key)?.id ?? null;
  }
  /** The real name of the item a key is filed under, from the tracker or the game data. */
  knownName(key: string): string | null { return this.byKey.get(key)?.n ?? this.catalog.get(key)?.name ?? null; }
  /** The game-data item a name read off the screen means, if exactly one is that close. */
  nearestInCatalog(k: string, truncated: boolean, extra = 0): string | null {
    const memo = `${truncated ? 1 : 0}${extra}${k}`;
    if (!this.nearest.has(memo)) {
      this.catalogKeyList ??= [...this.catalog.keys()];
      this.nearest.set(memo, findKey(k, truncated, this.catalogKeyList, (x) => x, extra));
    }
    return this.nearest.get(memo) ?? null;
  }
  /** The same prices, with another catalog. */
  withCatalog(catalog: Catalog): MarketIndex { return new MarketIndex(this.data, catalog); }
}

/**
 * What an NPC pays for one of them: a share of its shop price (half, by default), rounded down. Null when no NPC
 * shop sells it, or when NPC prices are turned off.
 */
export function npcSellPrice(mk: MarketItem | null, ratio: number): number | null {
  if (!mk?.npc || !(ratio > 0)) return null;
  const v = Math.floor((mk.npc * Math.min(ratio, 100)) / 100);
  return v > 0 ? v : null;
}

/** fewer than 5 sales, or copies that sell for very different prices */
export const isRough = (mk: MarketItem | null): boolean => !!mk && /[lw]/.test(mk.f ?? '');

export function marketTip(mk: MarketItem | null): string {
  if (!mk) return '';
  const notes: string[] = [];
  if ((mk.f ?? '').includes('l')) notes.push('fewer than 5 sales, rough guide');
  if ((mk.f ?? '').includes('w')) notes.push('copies sell for very different prices');
  return `Market: ${mk.p ? `${fmtEach(mk.p)} typical sale` : 'no sales'} · ${salesTxt(mk.s)} · 24h ${pctTxt(mk.d)} · 7d ${pctTxt(mk.w)}`
    + (notes.length ? ` · ${notes.join(', ')}` : '');
}

/** Throwing stars (and bullets) are one item holding a count; arrows are real stacks. */
export function isSetItem(mk: MarketItem | null, name: string): boolean {
  if (mk) {
    const id = mk.id.split(':').pop() ?? '';
    return mk.c === 'Stars' || /^0*(207|233)\d{4}$/.test(id);
  }
  return /\bthrowing (stars?|knives)\b|\bbullets?\b/i.test(name);
}
