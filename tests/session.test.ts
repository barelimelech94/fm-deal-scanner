import { describe, expect, it } from 'vitest';
import type { RawListing, TooltipRead } from '../src/lib/types';
import { ShopSession, type Deal } from '../src/shop/session';
import { engine, NOW } from './helpers/market';

const raw = (name: string, price: number, o: Partial<RawListing> = {}): RawListing => ({
  name, truncated: false, nameConf: 95, cy: null, qty: 1, price, greyed: false, unsure: false, ...o,
});
const keys = (s: ShopSession) => [...s.rows.values()].map((r) => `${r.key}|${r.qty}|${r.price}`).sort();

function setup(over: Parameters<typeof engine>[0] = {}) {
  let t = NOW;
  const e = engine({ ...over, now: () => t });
  const sounds: Deal[] = [];
  const s = new ShopSession(e, { onDeal: (d) => sounds.push(d) });
  return { e, s, sounds, tick: (ms: number) => { t += ms; } };
}

const SHOP = [raw('Dark Guardian', 79999), raw('Bronze Chain Boots', 9999), raw('Lemona', 19999)];

describe('reading a shop', () => {
  it('takes a still screenshot at its word', () => {
    const { s } = setup();
    s.read(SHOP, false);
    expect(s.open).toBe(true);
    expect(keys(s)).toEqual(['bronze chain boots|1|9999', 'dark guardian|1|79999', 'lemona|1|19999']);
  });

  it('wants two reads of a live screen to agree first', () => {
    const { s } = setup();
    s.read(SHOP, true);
    expect(s.open).toBe(false);
    expect(s.recheck).toBe(true);
    s.read(SHOP, true);
    expect(s.open).toBe(true);
    expect(s.rows.size).toBe(3);
    expect(s.recheck).toBe(false);
  });

  it('keeps a listing through one bad frame between two good ones', () => {
    const { s } = setup();
    s.read(SHOP, true);
    s.read([SHOP[0]!, SHOP[1]!], true);   // the mouse hid Lemona
    s.read(SHOP, true);
    expect(keys(s)).toContain('lemona|1|19999');
  });

  it('never confirms a misread that shows up once', () => {
    const { s, sounds } = setup();
    s.read(SHOP, true);
    s.read(SHOP, true);
    s.read([...SHOP, raw('Traus', 55)], true);   // "55,000" caught half-drawn
    s.read(SHOP, true);
    s.read(SHOP, true);
    expect(keys(s)).not.toContain('traus|1|55');
    expect(sounds).toHaveLength(0);
  });

  it('counts identical listings', () => {
    const { s } = setup();
    s.read([...SHOP, raw('Lemona', 19999)], false);
    expect(s.rows.size).toBe(3);
    expect(s.listingCount()).toBe(4);
  });

  it('drops doubtful names that match no item, and keeps known ones', () => {
    const { s } = setup();
    s.read([raw('Xq;ww', 100, { nameConf: 20 }), raw('Lemona', 19999, { nameConf: 20 }), raw('Rare Thing', 5, { nameConf: 80 })], false);
    expect(keys(s)).toEqual(['lemona|1|19999', 'rare thing|1|5']);
  });

  it('closes after two looks without a list, not one', () => {
    const { s } = setup();
    s.read(SHOP, false);
    s.read([], true);
    expect(s.open).toBe(true);
    s.read([], true);
    expect(s.open).toBe(false);
    expect(s.rows.size).toBe(0);
  });

  it('does not close while a tooltip covers the list', () => {
    const { s } = setup();
    s.read(SHOP, false);
    s.read([], true);
    s.covered();
    s.read([], true);
    expect(s.open).toBe(true);
  });

  it('starts over in a different shop', () => {
    const { s } = setup();
    s.read(SHOP, false);
    s.read([], true);   // the list is gone for a moment between two shops
    s.read([raw('Traus', 50000), raw('Axe Pole Arm', 15000)], false);
    expect(keys(s)).toEqual(['axe pole arm|1|15000', 'traus|1|50000']);
  });

  it('uses the tracker spelling and prices stars per set', () => {
    const { s } = setup();
    s.read([raw('olbi Throwing Stars', 2999, { qty: 500 }), raw('Arrows for Bows', 4000, { qty: 1000 })], false);
    const [stars, arrows] = [...s.rows.values()];
    expect(stars).toMatchObject({ name: 'Wolbi Throwing Stars', set: true, units: 1, unit: 2999 });
    expect(arrows).toMatchObject({ set: false, units: 1000, unit: 4 });
  });

  it('learns prices, except sold and unclear ones', () => {
    const { s, e } = setup();
    const changed = s.read([raw('Traus', 50000), raw('Lemona', 1, { greyed: true }), raw('Axe Pole Arm', 15, { unsure: true })], false);
    expect(changed).toBe(true);
    expect(Object.keys(e.book.items)).toEqual(['traus']);
    expect(e.book.items.traus!.s[0]![1]).toBe(50000);
  });
});

describe('listings that sell', () => {
  const states = (s: ShopSession) => [...s.rows.values()].map((r) => `${r.key}:${r.greyed ? 'sold' : 'live'}×${r.count}`).sort();

  it('replaces a live listing with its sold twin', () => {
    const { s } = setup();
    s.read([raw('Traus', 30000)], false);
    s.read([raw('Traus', 30000, { greyed: true })], false);
    expect(states(s)).toEqual(['traus:sold×1']);
    expect(s.listingCount()).toBe(1);
  });

  it('takes the copies bought off the live count', () => {
    const { s } = setup();
    const t = (greyed = false) => raw('Traus', 50000, { greyed });
    s.read([t(), t(), t()], false);
    expect(states(s)).toEqual(['traus:live×3']);
    s.read([t(), t(true), t(true)], false);   // two of three bought
    expect(states(s)).toEqual(['traus:live×1', 'traus:sold×2']);
    s.read([t(), t(true), t(true)], false);   // nothing new
    expect(states(s)).toEqual(['traus:live×1', 'traus:sold×2']);
    s.read([t(true), t(true), t(true)], false);   // the last one too
    expect(states(s)).toEqual(['traus:sold×3']);
  });

  it('does the same on a live screen, once the sold row is confirmed', () => {
    const { s } = setup();
    const t = (greyed = false) => raw('Traus', 50000, { greyed });
    s.read([t(), t()], true); s.read([t(), t()], true);
    s.read([t(), t(true)], true);
    expect(states(s)).toEqual(['traus:live×2']);   // one read is not enough
    s.read([t(), t(true)], true);
    expect(states(s)).toEqual(['traus:live×1', 'traus:sold×1']);
  });

  it('leaves listings already sold when the shop opened alone', () => {
    const { s } = setup();
    s.read([raw('Traus', 50000), raw('Traus', 50000, { greyed: true })], false);
    expect(states(s)).toEqual(['traus:live×1', 'traus:sold×1']);
  });

  it('keeps a live copy that is still on screen', () => {
    const { s } = setup();
    s.read([raw('Traus', 50000)], false);
    s.read([raw('Traus', 50000), raw('Traus', 50000, { greyed: true })], false);   // a second copy seen only sold
    expect(states(s)).toEqual(['traus:live×1', 'traus:sold×1']);
  });
});

describe('the next shop', () => {
  const at = (name: string, price: number, fy: number) => raw(name, price, { fy });
  const AB = [at('Traus', 50000, 0.30), at('Lemona', 19999, 0.34)];

  it('starts over after a gap when nothing is where it was, even with one listing', () => {
    const { s, tick, e } = setup();
    s.read(AB, false);
    const since = s.since;
    s.read([], true);
    tick(5000);
    s.read([at('Axe Pole Arm', 15000, 0.30)], false);
    expect(keys(s)).toEqual(['axe pole arm|1|15000']);
    expect(s.since).toBe(e.now());
    expect(s.since).not.toBe(since);
  });

  it('starts over when the one shared listing sits somewhere else', () => {
    const { s } = setup();
    s.read(AB, false);
    s.read([], true);
    s.read([at('Bronze Chain Boots', 9999, 0.30), at('Traus', 50000, 0.34)], false);
    expect(keys(s)).toEqual(['bronze chain boots|1|9999', 'traus|1|50000']);
  });

  it('is the same shop when a listing is back where it was', () => {
    const { s, tick } = setup();
    s.read(AB, false);
    const since = s.since;
    s.read([], true);
    tick(5000);
    s.read([at('Traus', 50000, 0.305), at('Dark Guardian', 79999, 0.38)], false);   // within half a row
    expect(keys(s)).toEqual(['dark guardian|1|79999', 'lemona|1|19999', 'traus|1|50000']);
    expect(s.since).toBe(since);
  });

  it('keeps the deal log across shops', () => {
    const { s } = setup();
    s.read([at('Traus', 30000, 0.3)], false);
    s.read([], true);
    s.read([at('Lemona', 19999, 0.5)], false);
    expect(s.deals.map((d) => d.key)).toEqual(['traus']);
  });

  it('does not start over without a gap', () => {
    const { s } = setup();
    s.read(AB, false);
    s.read([at('Dark Guardian', 79999, 0.30), at('Axe Pole Arm', 15000, 0.34)], false);
    expect(s.rows.size).toBe(4);
  });
});

describe('deals', () => {
  it('sounds once for a new deal and keeps it in the log', () => {
    const { s, sounds, tick } = setup();
    s.read([raw('Traus', 30000)], false);
    expect(sounds).toHaveLength(1);
    expect(s.lastDeal).toMatchObject({ key: 'traus', price: 30000, verdict: 'deal' });
    // the shop closes and opens again a minute later: no second sound
    s.read([], true); s.read([], true);
    tick(60e3);
    s.read([raw('Traus', 30000)], false);
    expect(sounds).toHaveLength(1);
    expect(s.deals).toHaveLength(1);
    // ten minutes on, it's worth a reminder
    s.read([], true); s.read([], true);
    tick(10 * 60e3);
    s.read([raw('Traus', 30000)], false);
    expect(sounds).toHaveLength(2);
  });

  it('judges a listing by the prices from before it was seen', () => {
    const { s, e } = setup({ settings: { minSeen: 1 } });
    s.read([raw('Mystery Rock', 100)], false);
    expect(e.book.items['mystery rock']!.s).toHaveLength(1);
    expect([...s.rows.values()][0]!.verdict).toBe('new');
  });

  it('clears the log', () => {
    const { s } = setup();
    s.read([raw('Traus', 30000)], false);
    s.clearDeals();
    expect(s.deals).toEqual([]);
    expect(s.lastDeal).toBeNull();
  });
});

describe('stats from tooltips', () => {
  const traus = (total: number, remaining = 7): TooltipRead => ({
    key: 'traus', name: 'Traus', type: 'One-handed Sword', remaining,
    stats: [{ label: 'att', weight: 1, total, base: 60, delta: total - 60 }],
  });

  it('gives each hovered copy of identical listings its own row', () => {
    const { s } = setup();
    s.read([raw('Traus', 50000, { fy: 0.4 }), raw('Traus', 50000, { fy: 0.5 }), raw('Traus', 50000, { fy: 0.6 })], false);
    expect(s.displayRows()).toHaveLength(1);
    s.applyTooltip(traus(64), 0.4);
    s.applyTooltip(traus(57), 0.5);
    const rows = s.displayRows();
    expect(rows.map((r) => [r.count, r.sig ?? null, r.unchecked ?? false, r.verdict])).toEqual([
      [1, 'att:64/60|7', false, 'deal'],
      [1, 'att:57/60|7', false, 'high'],   // 3 under: worth 24% less
      [1, null, true, 'fair'],
    ]);
    // hovering a copy again doesn't add a row
    s.applyTooltip(traus(64), 0.4);
    expect(s.displayRows()).toHaveLength(3);
  });

  it('never has more hovered copies than listings', () => {
    const { s } = setup();
    s.read([raw('Traus', 50000)], false);
    s.applyTooltip(traus(61), 0.5);
    s.applyTooltip(traus(62), 0.5);   // a misread of the same copy
    expect(s.displayRows().map((r) => r.sig)).toEqual(['att:62/60|7']);
  });

  it('puts the stats on the listing nearest the tooltip', () => {
    const { s } = setup();
    s.read([raw('Traus', 42000, { fy: 0.35 }), raw('Traus', 47000, { fy: 0.62 })], false);
    s.applyTooltip(traus(55, 7), 0.6);
    const rows = s.displayRows();
    expect(rows.find((r) => r.price === 47000)!.sig).toBe('att:55/60|7');
    expect(rows.find((r) => r.price === 42000)!.sig).toBeUndefined();
  });

  it('updates a lone listing\'s deal with its stats, without a second sound', () => {
    const { s, sounds } = setup();
    s.read([raw('Traus', 30000)], false);
    expect(sounds).toHaveLength(1);
    s.applyTooltip(traus(62), 0.5);
    expect(sounds).toHaveLength(1);
    expect(s.deals).toHaveLength(1);
    expect(s.deals[0]!.stats?.summary).toBe('+2 att, 7 slots left');
  });

  it('drops a deal the stats disprove, once every copy was hovered', () => {
    const { s } = setup();
    s.read([raw('Traus', 40000)], false);
    expect(s.deals).toHaveLength(1);
    s.applyTooltip(traus(56, 3), 0.5);
    expect(s.deals).toHaveLength(0);
    expect(s.lastDeal).toBeNull();
  });

  it('logs a hovered copy that is a deal when the listing wasn\'t', () => {
    const { s, sounds } = setup();
    s.read([raw('Traus', 50000), raw('Traus', 50000)], false);
    expect(sounds).toHaveLength(0);
    s.applyTooltip(traus(64), 0.5);
    expect(sounds).toHaveLength(1);
    expect(s.deals[0]).toMatchObject({ sig: 'att:64/60|7', verdict: 'deal' });
  });

  it('learns how many slots an item starts with', () => {
    const { s, e } = setup();
    s.read([raw('Traus', 50000)], false);
    expect(s.applyTooltip(traus(60, 9), 0.5)).toBe(true);
    expect(e.book.items.traus!.maxSlots).toBe(9);
    expect(s.applyTooltip(traus(60, 8), 0.5)).toBe(false);
  });

  it('shows what was hovered even outside a shop', () => {
    const { s } = setup();
    s.applyTooltip(traus(62), 0.5);
    expect(s.hover).toMatchObject({ key: 'traus', rec: null, summary: '+2 att, 7 slots left' });
    expect(s.hover!.mult).toBeCloseTo(1.16);
  });

  it('re-judges everything when a setting changes', () => {
    const { s, e } = setup();
    s.read([raw('Traus', 45000)], false);
    expect([...s.rows.values()][0]!.verdict).toBe('fair');
    e.settings.discount = 10;
    s.reevaluate();
    expect([...s.rows.values()][0]!.verdict).toBe('deal');
  });
});
