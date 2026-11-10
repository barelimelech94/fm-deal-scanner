import { describe, expect, it } from 'vitest';
import type { MarketData, MarketItem } from '../src/lib/types';
import { marketTip } from '../src/market/marketIndex';
import { mergeMarket } from '../src/market/mergeMarket';

const DAY = 864e5;
const T0 = Date.UTC(2026, 10, 1, 12);
const item = (id: string, n: string, p: number, o: Partial<MarketItem> = {}): MarketItem => ({ id, n, c: 'Equips', p, s: 10, d: null, w: null, ...o });
const page = (world: string, asOf: number, items: MarketItem[], updated = 'Nov 1, 2:30 PM'): MarketData => ({ world, updated, asOf, items });

describe('mergeMarket', () => {
  const first = page('Windia', T0, [item('basil:1', 'Traus', 55000), item('basil:2', 'Lemona', 21000)]);

  it('takes the new page alone when there was nothing', () => {
    const next = page('Windia', T0 + DAY, [item('basil:3', 'Axe Pole Arm', 15000)]);
    expect(mergeMarket(null, next)).toEqual(next);
  });

  it('adds the pages of one world up, the newer price winning', () => {
    const next = page('windia', T0 + DAY, [item('basil:2', 'Lemona', 19000), item('basil:3', 'Axe Pole Arm', 15000)], 'Nov 2, 9:00 AM');
    const m = mergeMarket(first, next);
    expect(m.world).toBe('windia');
    expect(m.asOf).toBe(T0 + DAY);
    expect(m.updated).toBe('Nov 2, 9:00 AM');
    const byId = Object.fromEntries(m.items.map((x) => [x.id, x]));
    expect(Object.keys(byId).sort()).toEqual(['basil:1', 'basil:2', 'basil:3']);
    expect(byId['basil:2']).toEqual(item('basil:2', 'Lemona', 19000));   // from the new page, no age of its own
    expect(byId['basil:3']!.t).toBeUndefined();
    expect(byId['basil:1']).toEqual({ ...item('basil:1', 'Traus', 55000), t: T0 });   // kept, with when it was taken
  });

  it('keeps an old row\'s own age through more loads', () => {
    const second = mergeMarket(first, page('Windia', T0 + DAY, [item('basil:2', 'Lemona', 19000)]));
    const third = mergeMarket(second, page('Windia', T0 + 2 * DAY, [item('basil:2', 'Lemona', 18000)]));
    expect(third.items.find((x) => x.id === 'basil:1')!.t).toBe(T0);
  });

  it('merges pages with no world named', () => {
    const m = mergeMarket(page('', T0, [item('basil:1', 'Traus', 55000)]), page('', T0 + DAY, [item('basil:2', 'Lemona', 1)]));
    expect(m.items).toHaveLength(2);
  });

  it('starts over for another world', () => {
    const next = page('Bera', T0 + DAY, [item('basil:3', 'Axe Pole Arm', 15000)]);
    expect(mergeMarket(first, next)).toEqual(next);
    expect(mergeMarket(first, page('', T0 + DAY, next.items))).toEqual(page('', T0 + DAY, next.items));
  });

  it('does not change what it was given', () => {
    const copy = structuredClone(first);
    mergeMarket(first, page('Windia', T0 + DAY, [item('basil:2', 'Lemona', 1)]));
    expect(first).toEqual(copy);
  });
});

describe('marketTip', () => {
  it('says how old a price is when it is older than the rest', () => {
    expect(marketTip(item('basil:1', 'Traus', 55000, { t: T0 }), T0 + 3 * DAY)).toContain('price from 3d ago');
    expect(marketTip(item('basil:1', 'Traus', 55000), T0 + 3 * DAY)).not.toContain('ago');
  });
});
