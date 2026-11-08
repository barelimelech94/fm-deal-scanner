import { describe, expect, it } from 'vitest';
import { DAY } from '../src/lib/format';
import { DEFAULT_SETTINGS, type PriceMode } from '../src/lib/types';
import { usualPrice } from '../src/pricing/evaluate';
import { newItem, sightingStats } from '../src/pricing/priceBook';
import { market, NOW } from './helpers/market';

const s = DEFAULT_SETTINGS;
const seen = (...units: number[]) => units.map((u, i): [number, number, number] => [NOW - (i + 1) * 3600e3, u, 1]);
const item = (...units: number[]) => ({ ...newItem('X'), s: seen(...units) });
const traus = market().get('traus');                        // market 55,000, 94 sales
const fan = market().get('korean fan');                     // market 68,888, "wide range"
const chaos = market().get('gloves attack scroll chaos');   // market 1,844,444, "low data"
const price = (mode: PriceMode, it: ReturnType<typeof item> | null, mk = traus, settings = s) => usualPrice(it, mk, settings, NOW, mode);

describe('price modes', () => {
  it('keeps the shop scanner on cheap, whatever is passed or not', () => {
    const it = item(40000, 41000, 42000);
    expect(usualPrice(it, traus, s, NOW)).toEqual(usualPrice(it, traus, s, NOW, 'cheap'));
    expect(usualPrice(it, traus, s, NOW)).toMatchObject({ value: 41000, src: 'seen' });
  });

  it('adds the upper quarter of your sightings to their stats', () => {
    expect(sightingStats(item(40000, 50000, 60000, 70000), NOW)).toMatchObject({ n: 4, q25: 47500, median: 55000, q75: 62500 });
    expect(sightingStats(undefined, NOW).q75).toBeNull();
  });

  describe('every mode', () => {
    it('takes your typed price first', () => {
      for (const m of ['cheap', 'fair', 'greedy'] as const) {
        expect(price(m, { ...item(90000, 91000, 92000), manualRef: 70000 })).toEqual({ value: 70000, src: 'yours', rough: false });
      }
    });
    it('has no price when there is nothing to go on', () => {
      for (const m of ['cheap', 'fair', 'greedy'] as const) expect(price(m, null, null)).toBeNull();
    });
    it('ignores the market when it is turned off', () => {
      for (const m of ['cheap', 'fair', 'greedy'] as const) expect(price(m, null, traus, { ...s, market: 'off' })).toBeNull();
    });
    it('needs enough sightings before they count', () => {
      for (const m of ['cheap', 'fair', 'greedy'] as const) expect(price(m, item(1000, 2000), null)).toBeNull();
    });
  });

  describe('fair', () => {
    it("is the tracker's typical price, even when your sightings are lower or higher", () => {
      expect(price('fair', item(40000, 41000, 42000))).toEqual({ value: 55000, src: 'market', rough: false });
      expect(price('fair', item(80000, 81000, 82000))).toEqual({ value: 55000, src: 'market', rough: false });
      expect(price('fair', null)).toEqual({ value: 55000, src: 'market', rough: false });
    });
    it('uses the middle of your sightings where the tracker has no price', () => {
      expect(price('fair', item(1000, 2000, 3000, 4000), null)).toEqual({ value: 2500, src: 'seen', rough: false });
      expect(price('fair', item(1000, 2000, 3000, 4000), market().get('unsold cape'))).toMatchObject({ value: 2500, src: 'seen' });
    });
    it('carries the tracker\'s warnings', () => {
      expect(price('fair', null, fan)).toMatchObject({ value: 68888, rough: true });
      expect(price('fair', null, chaos)).toMatchObject({ value: 1844444, rough: true });
    });
  });

  describe('greedy', () => {
    it('is the higher of the tracker and the upper quarter of your sightings', () => {
      // sightings 80,000..83,000: upper quarter 82,250 beats the tracker's 55,000
      expect(price('greedy', item(80000, 81000, 82000, 83000))).toEqual({ value: 82250, src: 'seen', rough: false });
      // sightings under the tracker: the tracker stays
      expect(price('greedy', item(40000, 41000, 42000, 43000))).toEqual({ value: 55000, src: 'market', rough: false });
    });
    it('is the tracker alone, or the upper quarter alone, when only one exists', () => {
      expect(price('greedy', null)).toMatchObject({ value: 55000, src: 'market' });
      expect(price('greedy', item(1000, 2000, 3000, 4000), null)).toEqual({ value: 3250, src: 'seen', rough: false });
    });
    it('is never below fair', () => {
      for (const units of [[40000, 41000, 42000], [80000, 81000, 82000], [55000, 55000, 55000]]) {
        expect(price('greedy', item(...units))!.value).toBeGreaterThanOrEqual(price('fair', item(...units))!.value);
      }
    });
  });

  describe('cheap', () => {
    it('is never above fair when the tracker has a price', () => {
      for (const units of [[40000, 41000, 42000], [80000, 81000, 82000]]) {
        expect(price('cheap', item(...units))!.value).toBeLessThanOrEqual(price('fair', item(...units))!.value);
      }
    });
    it('ignores sightings older than two weeks, like the other modes', () => {
      const old = { ...newItem('X'), s: [NOW - 20 * DAY, NOW - 21 * DAY, NOW - 22 * DAY].map((t): [number, number, number] => [t, 9, 1]) };
      expect(price('greedy', old)).toMatchObject({ value: 55000, src: 'market' });
    });
  });
});
