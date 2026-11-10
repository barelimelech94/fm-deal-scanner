import { describe, expect, it } from 'vitest';
import type { MarketData, MarketItem } from '../src/lib/types';
import { marketTip } from '../src/market/marketIndex';
import { mergeMarket, mergeMarketPages } from '../src/market/mergeMarket';

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

describe('mergeMarketPages', () => {
  const kept = page('Windia', T0, [item('basil:1', 'Traus', 55000), item('basil:2', 'Lemona', 21000)]);

  it('adds every page to the prices kept, oldest first, so the newest price wins', () => {
    const newer = page('Windia', T0 + 2 * DAY, [item('basil:2', 'Lemona', 18000)], 'Nov 3');
    const older = page('Windia', T0 + DAY, [item('basil:2', 'Lemona', 30000), item('basil:3', 'Axe Pole Arm', 15000)], 'Nov 2');
    const r = mergeMarketPages(kept, [newer, older]);
    const byId = Object.fromEntries(r.data.items.map((x) => [x.id, x.p]));
    expect(byId).toEqual({ 'basil:1': 55000, 'basil:2': 18000, 'basil:3': 15000 });
    expect(r.data.updated).toBe('Nov 3');
    // Lemona and the axe: added or updated; Traus was kept as it was
    expect(r).toMatchObject({ changed: 2, replaced: null });
  });

  it('counts only priced rows as prices changed', () => {
    const r = mergeMarketPages(null, [page('Windia', T0, [item('basil:1', 'Traus', 55000), { ...item('basil:9', 'Unsold Cape', 0), p: null }])]);
    expect(r).toMatchObject({ changed: 1, replaced: null });
    expect(r.data.items).toHaveLength(2);
  });

  it('says when the prices of another world were replaced', () => {
    const r = mergeMarketPages(kept, [page('Bera', T0 + DAY, [item('basil:3', 'Axe Pole Arm', 15000)])]);
    expect(r.data.world).toBe('Bera');
    expect(r.data.items.map((x) => x.id)).toEqual(['basil:3']);
    expect(r).toMatchObject({ changed: 1, replaced: 'Windia' });
  });

  it('counts nothing changed when the same page is loaded again', () => {
    const again = mergeMarketPages(kept, [kept]);
    expect(again).toMatchObject({ changed: 0, replaced: null });
    expect(mergeMarketPages(kept, [page('Windia', T0 + DAY, [item('basil:2', 'Lemona', 21000), item('basil:3', 'Axe Pole Arm', 15000)])]).changed).toBe(1);
  });

  it('names the world kept before once, and only when the prices now are for another', () => {
    // Windia kept; a Bera page, then a newer Windia page: the prices are Windia's again
    const back = mergeMarketPages(kept, [page('Bera', T0 + DAY, [item('basil:3', 'Axe Pole Arm', 15000)]), page('Windia', T0 + 2 * DAY, [item('basil:2', 'Lemona', 21000)])]);
    expect(back.data.world).toBe('Windia');
    expect(back.replaced).toBeNull();
    // a Windia page, then a newer Bera one: Windia's prices were replaced, said once
    const away = mergeMarketPages(kept, [page('Windia', T0 + DAY, [item('basil:2', 'Lemona', 19000)]), page('Bera', T0 + 2 * DAY, [item('basil:3', 'Axe Pole Arm', 15000)])]);
    expect(away).toMatchObject({ replaced: 'Windia', changed: 1 });
  });

  it('replaces nothing when there were no prices', () => {
    const none = page('', 0, []);
    expect(mergeMarketPages(none, [page('Bera', T0, [item('basil:3', 'Axe Pole Arm', 15000)])]).replaced).toBeNull();
  });
});
