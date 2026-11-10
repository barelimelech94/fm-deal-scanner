import { describe, expect, it } from 'vitest';
import { DAY } from '../src/lib/format';
import type { Listing, PriceBook, TooltipRead } from '../src/lib/types';
import { evaluate, usualPrice } from '../src/pricing/evaluate';
import {
  fixSetSightings, isPriceBook, logSighting, mergeBackup, mergeIntoMarket, newItem, pruneOld, sightingStats,
} from '../src/pricing/priceBook';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { engine, FACTS, market, NOW } from './helpers/market';

const listing = (o: Partial<Listing> & { key: string; price: number }): Listing => ({
  name: o.key, truncated: false, nameConf: 95, cy: 0, qty: 1, greyed: false, unsure: false,
  known: true, set: false, units: o.qty ?? 1, unit: o.price / (o.qty ?? 1), ...o,
});
const book = (items: PriceBook['items'] = {}): PriceBook => ({ items });
const seen = (...units: number[]) => units.map((u, i): [number, number, number] => [NOW - (i + 1) * 3600e3, u, 1]);

describe('sightingStats', () => {
  it('summarizes the last two weeks only', () => {
    const it = { ...newItem('Traus'), s: [...seen(40000, 50000, 60000), [NOW - 20 * DAY, 1, 1] as [number, number, number]] };
    expect(sightingStats(it, NOW)).toMatchObject({ n: 3, median: 50000, q25: 45000, low: 40000, last: NOW - 3600e3 });
    expect(sightingStats(undefined, NOW).n).toBe(0);
  });
});

describe('usualPrice', () => {
  const s = DEFAULT_SETTINGS;
  const mk = market().get('traus');
  it('takes your typed price first', () => {
    expect(usualPrice({ ...newItem('Traus'), manualRef: 70000 }, mk, s, NOW)).toEqual({ value: 70000, src: 'yours', rough: false });
  });
  it('takes the lower of the market and your sightings', () => {
    expect(usualPrice({ ...newItem('Traus'), s: seen(40000, 41000, 42000) }, mk, s, NOW)).toMatchObject({ value: 41000, src: 'seen' });
    expect(usualPrice({ ...newItem('Traus'), s: seen(80000, 81000, 82000) }, mk, s, NOW)).toMatchObject({ value: 55000, src: 'market' });
  });
  it('needs enough sightings, and can use the lower quartile', () => {
    expect(usualPrice({ ...newItem('X'), s: seen(1000, 2000) }, null, s, NOW)).toBeNull();
    expect(usualPrice({ ...newItem('X'), s: seen(1000, 2000, 3000, 4000) }, null, { ...s, base: 'q25' }, NOW)?.value).toBe(1750);
  });
  it('ignores the market when it is turned off', () => {
    expect(usualPrice(null, mk, { ...s, market: 'off' }, NOW)).toBeNull();
  });
  it('says when the market price is rough', () => {
    expect(usualPrice(null, market().get('korean fan'), s, NOW)?.rough).toBe(true);
  });
});

describe('evaluate', () => {
  it('calls a listing far enough under the usual price, with enough profit, a deal', () => {
    // Traus usually 55,000: 40,000 is 27% under, and 55,000 × 0.97 − 40,000 = 13,350
    const ev = evaluate(engine(), listing({ key: 'traus', price: 40000 }));
    expect(ev).toMatchObject({ verdict: 'deal', usual: 55000, usualSrc: 'market', profit: 13350 });
    expect(ev.pct).toBeCloseTo(-0.2727, 3);
  });
  it('is fair close to the usual price and high well above it', () => {
    expect(evaluate(engine(), listing({ key: 'traus', price: 50000 })).verdict).toBe('fair');
    expect(evaluate(engine(), listing({ key: 'traus', price: 64000 })).verdict).toBe('high');
  });
  it('wants the minimum profit too', () => {
    // Arrows for Bows at 5 each: 3 each is 40% under, but a stack of 100 makes 185
    expect(evaluate(engine(), listing({ key: 'arrows for bows', qty: 100, price: 300 })).verdict).toBe('fair');
    expect(evaluate(engine(), listing({ key: 'arrows for bows', qty: 1000, price: 3000 })).verdict).toBe('fair');
    expect(evaluate(engine({ settings: { minProfit: 1000 } }), listing({ key: 'arrows for bows', qty: 1000, price: 3000 })).verdict).toBe('deal');
  });
  it('prices a set of stars as one item', () => {
    // a set of Tobi stars usually 1,850,000; 500 of them for 900,000 is one set, not 1,800 each
    const ev = evaluate(engine(), listing({ key: 'tobi throwing stars', qty: 500, set: true, units: 1, price: 900000, unit: 900000 }));
    expect(ev.verdict).toBe('deal');
    expect(ev.profit).toBe(Math.round(1850000 * 0.97 - 900000));
  });
  it('asks you to check a deal on a rough market price', () => {
    expect(evaluate(engine(), listing({ key: 'korean fan', price: 30000 }))).toMatchObject({ verdict: 'unsure', why: expect.stringContaining('very different prices') });
    expect(evaluate(engine(), listing({ key: 'gloves attack scroll chaos', price: 900000 }))).toMatchObject({ verdict: 'unsure', why: expect.stringContaining('fewer than 5') });
  });
  it('asks you to check a deal whose price did not read cleanly', () => {
    expect(evaluate(engine(), listing({ key: 'traus', price: 99, unsure: true })).verdict).toBe('unsure');
  });
  it('calls anything at your buy-under price a deal', () => {
    const b = book({ traus: { ...newItem('Traus'), buyUnder: 52000 } });
    expect(evaluate(engine({ book: b }), listing({ key: 'traus', price: 52000 }))).toMatchObject({ verdict: 'deal', target: true });
  });
  it('knows a sold listing', () => {
    expect(evaluate(engine(), listing({ key: 'traus', price: 40000, greyed: true })).verdict).toBe('sold');
  });
  it('has no verdict without a usual price', () => {
    expect(evaluate(engine(), listing({ key: 'mystery rock', price: 10, known: false })).verdict).toBe('new');
  });

  describe('with stats from the tooltip', () => {
    const tip = (total: number, remaining: number): TooltipRead => ({
      key: 'traus', name: 'Traus', type: 'One-handed Sword', remaining,
      stats: [{ label: 'att', weight: 1, total, base: 60, delta: total - 60 }],
    });
    it('scales the usual price and keeps the price before', () => {
      const ev = evaluate(engine(), { ...listing({ key: 'traus', price: 50000 }), tip: tip(63, 7) });
      expect(ev.usualBase).toBe(55000);
      expect(ev.usual).toBeCloseTo(55000 * 1.24);
      expect(ev.verdict).toBe('deal');
    });
    it('can turn a deal into a fair price', () => {
      expect(evaluate(engine(), listing({ key: 'traus', price: 40000 })).verdict).toBe('deal');
      // 2 attack under and one slot used: 3 points, 24% off the usual 55,000
      expect(evaluate(engine(), { ...listing({ key: 'traus', price: 40000 }), tip: tip(58, 6) }).verdict).toBe('fair');
    });
    it("reads the base and the slots from the game data when it has the item's", () => {
      // no base and no type read: on their own, the stats look average and the slots unknown
      const t: TooltipRead = { key: 'traus', name: 'Traus', type: '', remaining: 6, stats: [{ label: 'att', weight: 1, total: 63, base: 63, delta: 0 }] };
      const row = { ...listing({ key: 'traus', price: 50000 }), tip: t };
      expect(evaluate(engine(), row).stats!.summary).toBe('average stats, 6 slots left');
      const ev = evaluate(engine({ facts: FACTS }), row);
      expect(ev.stats!.summary).toBe('+3 att, 1 of 7 slots used');
      expect(ev.usual).toBeCloseTo(55000 * 1.16);
    });
    it('settles a rough market price', () => {
      const t: TooltipRead = { ...tip(60, 7), key: 'korean fan', name: 'Korean Fan', type: 'Fan' };
      expect(evaluate(engine(), { ...listing({ key: 'korean fan', price: 30000 }), tip: t }).verdict).toBe('deal');
    });
  });
});

describe('logSighting', () => {
  it('records once per price within five minutes', () => {
    const b = book();
    const r = listing({ key: 'traus', price: 40000 });
    logSighting(b, r, 'Traus', NOW);
    logSighting(b, r, 'Traus', NOW + 60e3);
    logSighting(b, r, 'Traus', NOW + 6 * 60e3);
    logSighting(b, { ...r, price: 41000, unit: 41000 }, 'Traus', NOW + 61e3);
    expect(b.items.traus!.s.map((x) => x[1])).toEqual([40000, 40000, 41000]);
    expect(b.items.traus!.name).toBe('Traus');
  });
  it('keeps at most 400 sightings', () => {
    const b = book();
    for (let i = 0; i < 450; i++) logSighting(b, listing({ key: 'x', price: 1000 + i }), 'X', NOW + i);
    expect(b.items.x!.s).toHaveLength(400);
    expect(b.items.x!.s[0]![1]).toBe(1050);
  });
});

describe('pruneOld', () => {
  it('deletes sightings older than 30 days', () => {
    const b = book({ x: { ...newItem('X'), s: [[NOW - 31 * DAY, 1, 1], [NOW - 29 * DAY, 2, 1]] } });
    pruneOld(b, NOW);
    expect(b.items.x!.s).toEqual([[NOW - 29 * DAY, 2, 1]]);
  });
});

describe('mergeIntoMarket', () => {
  it('moves sightings filed under a misread onto the tracker name, typed prices too', () => {
    const b = book({
      'bronze chain boots': { ...newItem('Bronze Chain Boots'), s: [[NOW - 1, 12000, 1]] },
      'bronze chain bools': { ...newItem('Bronze Chain Bools'), s: [[NOW - 2, 11000, 1]], buyUnder: 9000 },
      'trau5': { ...newItem('Trau5'), s: [[NOW - 5, 1, 1]] },   // too short to guess at
      'gloves attack scroll': { ...newItem('Gloves Attack Scroll'), s: [[NOW - 3, 1, 1]] },   // which tier?
      'soft chocolate fon': { ...newItem('Soft Chocolate Fon…'), s: [[NOW - 4, 2, 1]] },
    });
    expect(mergeIntoMarket(b, market())).toBe(2);
    expect(Object.keys(b.items).sort()).toEqual(['bronze chain boots', 'gloves attack scroll', 'soft chocolate fondue scepter', 'trau5']);
    expect(b.items['bronze chain boots']).toMatchObject({ buyUnder: 9000, s: [[NOW - 2, 11000, 1], [NOW - 1, 12000, 1]] });
    expect(b.items['soft chocolate fondue scepter']!.name).toBe('Soft Chocolate Fondue Scepter');
  });
  it('does nothing without a market', () => {
    expect(mergeIntoMarket(book({ x: newItem('x') }), market([]))).toBe(0);
  });
});

describe('fixSetSightings', () => {
  it('turns per-star prices back into per-set prices', () => {
    const b = book({ 'wolbi throwing stars': { ...newItem('Wolbi Throwing Stars'), s: [[NOW, 6, 500], [NOW, 2999, 1]] } });
    expect(fixSetSightings(b, market())).toBe(1);
    expect(b.items['wolbi throwing stars']!.s).toEqual([[NOW, 3000, 1], [NOW, 2999, 1]]);
  });
});

describe('mergeBackup', () => {
  it('adds what the backup has and keeps what is here', () => {
    const b = book({ traus: { ...newItem('Traus'), manualRef: 60000, s: [[1, 50000, 1]] } });
    const n = mergeBackup(b, book({
      traus: { ...newItem('Traus'), manualRef: 99, buyUnder: 40000, s: [[1, 50000, 1], [2, 52000, 1]] },
      lemona: { ...newItem('Lemona'), s: [[3, 20000, 1]] },
    }));
    expect(n).toBe(2);
    expect(b.items.traus).toMatchObject({ manualRef: 60000, buyUnder: 40000, s: [[1, 50000, 1], [2, 52000, 1]] });
    expect(b.items.lemona!.s).toEqual([[3, 20000, 1]]);
  });
  it('recognizes a price book', () => {
    expect(isPriceBook({ items: {} })).toBe(true);
    expect(isPriceBook({ items: null })).toBe(false);
    expect(isPriceBook('x')).toBe(false);
  });
});
