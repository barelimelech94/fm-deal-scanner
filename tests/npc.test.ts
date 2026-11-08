// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appraiseEntry } from '../src/appraisal/appraise';
import { entryFor } from '../src/appraisal/entries';
import { DEFAULT_SETTINGS, type Listing, type MarketItem, type TooltipRead } from '../src/lib/types';
import { npcSellPrice } from '../src/market/marketIndex';
import { parseTrackerPage } from '../src/market/parseTrackerPage';
import { evaluate } from '../src/pricing/evaluate';
import { ShopSession } from '../src/shop/session';
import { appraisalRowHtml } from '../src/ui/appraisalViews';
import { dealLine, marketInfo, shopRowHtml } from '../src/ui/views';
import { engine, market, NOW } from './helpers/market';

const item = (n: string, p: number | null, npc: number | undefined, over: Partial<MarketItem> = {}): MarketItem =>
  ({ id: `basil:0${Math.abs(n.length * 7919)}`, n, c: 'Equips', p, s: 100, d: 0, w: 0, ...(npc ? { npc } : {}), ...over });

/** A market price of 3,000 and an NPC shop price of 20,000, so an NPC pays 10,000 (half). */
const ITEMS: MarketItem[] = [
  item('Junk Cap', 3000, 20000),
  item('Fine Cape', 30000, 20000),
  item('Plain Gloves', null, 8000),
  item('Plain Boots', 2000, 9000),
  item('Free Hat', 500, undefined),
  item('Wolbi Throwing Stars', 2499, 4000, { c: 'Stars' }),
  item('Red Potion', 40, 50, { c: 'Use' }),
];
const e = (over: Parameters<typeof engine>[0] = {}) => engine({ items: ITEMS, ...over });
const listing = (o: Partial<Listing> & { key: string; price: number }): Listing => ({
  name: o.key, truncated: false, nameConf: 95, cy: 0, qty: 1, greyed: false, unsure: false, known: true, set: false, units: o.qty ?? 1, unit: o.price / (o.qty ?? 1), ...o,
});

describe('reading NPC shop prices off the tracker page', () => {
  const html = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'tracker', 'real-sample.html'), 'utf8');
  const saved = new Date(2026, 10, 7, 22, 0).getTime();
  const m = parseTrackerPage(html, saved);
  const by = (n: string) => m.items.find((x) => x.n === n);

  it('reads the real page: its items, world and time', () => {
    expect(m.items).toHaveLength(11);
    expect(m.world).toBe('Windia');
    expect(m.updated).toBe('Nov 7, 9:30 PM');
  });

  it('takes the price an NPC shop charges, from the Source column', () => {
    expect(by('Weighted Earrings')?.npc).toBe(9000);
    expect(by('Adamantium Guards')?.npc).toBe(27600);
    expect(by('Meba')?.npc).toBe(16500);
    expect(by('Black Dragon Robe')?.npc).toBe(21600);
    expect(by('Mithril Pole Arm')?.npc).toBe(26000);
    expect(by('Hat Accuracy Scroll: Lesser')?.npc).toBe(15000);
  });

  it('reads a chip that says it is one of several shops', () => {
    expect(by('Red Potion')?.npc).toBe(50);   // "… + 8 more · 50 mesos each"
  });

  it('leaves items no NPC shop sells without one, and the rest of the row alone', () => {
    for (const n of ['Lemona', 'Overall Armor LUK Scroll: Greater', 'Cape INT Scroll: Lesser', 'Traus']) expect(by(n)?.npc, n).toBeUndefined();
    expect(by('Weighted Earrings')).toMatchObject({ p: 5617, s: 11362, c: 'Equips' });
  });

  const row = (chips: string) => `<table><tbody id="rows"><tr data-id="basil:1"><td><span class="item-name" title="X">X</span><span class="item-cat">Equips</span></td>
    <td data-col="price"><span class="meso" title="5,000 mesos">5K</span></td><td><span class="sales-count">9</span></td>
    <td data-col="from"><span class="src-chips">${chips}</span></td></tr></tbody></table>`;
  const chip = (kind: string, text: string) => `<span class="src-chip src-shop" data-src-tip="${kind}|${text}"></span>`;

  it('takes the lowest when several NPC shops sell it', () => {
    const p = parseTrackerPage(row(chip('NPC shop', 'A (Town) · 26,000 mesos each') + chip('NPC shop', 'B (Town) · 24,500 mesos each')), saved);
    expect(p.items[0]?.npc).toBe(24500);
  });

  it('does not take other prices on the row for an NPC shop price', () => {
    const p = parseTrackerPage(row(chip('Craft it', 'Weaponcrafting L10 · ~53.3K mesos each') + chip('NPC shop', 'A (Town) · 1,000 mesos each')), saved);
    expect(p.items[0]?.npc).toBe(1000);
    expect(parseTrackerPage(row(chip('Craft it', '~53.3K mesos each')), saved).items[0]?.npc).toBeUndefined();
    expect(parseTrackerPage(row(chip('NPC shop', 'A (Town) · no price')), saved).items[0]?.npc).toBeUndefined();
    expect(parseTrackerPage(row(''), saved).items[0]?.npc).toBeUndefined();
  });
});

describe('what an NPC pays', () => {
  const mk = (npc?: number) => item('X', 1000, npc);
  it('is half the shop price by default, rounded down', () => {
    expect(npcSellPrice(mk(20000), 50)).toBe(10000);
    expect(npcSellPrice(mk(27601), 50)).toBe(13800);
    expect(npcSellPrice(mk(50), 50)).toBe(25);
  });
  it('follows the setting, and never goes above the shop price', () => {
    expect(npcSellPrice(mk(20000), 40)).toBe(8000);
    expect(npcSellPrice(mk(20000), 100)).toBe(20000);
    expect(npcSellPrice(mk(20000), 250)).toBe(20000);
  });
  it('is nothing with no shop price, or when turned off', () => {
    expect(npcSellPrice(mk(), 50)).toBeNull();
    expect(npcSellPrice(null, 50)).toBeNull();
    expect(npcSellPrice(mk(20000), 0)).toBeNull();
    expect(npcSellPrice(mk(20000), -5)).toBeNull();
    expect(npcSellPrice(mk(1), 50)).toBeNull();   // rounds down to nothing
    expect(DEFAULT_SETTINGS.npcRatio).toBe(50);
  });
});

describe('a shop listing and an NPC', () => {
  it('is a deal when an NPC pays enough more than it costs, with no market involved', () => {
    // the market says 3,000, so 4,000 is pricey; an NPC pays 10,000
    const ev = evaluate(e(), listing({ key: 'junk cap', price: 4000 }));
    expect(ev).toMatchObject({ verdict: 'deal', npcFlip: true, npc: 10000, profit: 6000 });
    expect(ev.pct).toBeGreaterThan(0.15);
  });

  it('is not a deal when the profit is under the minimum, though the NPC price is still shown', () => {
    const ev = evaluate(e(), listing({ key: 'junk cap', price: 8000 }));   // 2,000 profit, minimum is 3,000
    expect(ev).toMatchObject({ npcFlip: false, npc: 10000 });
    expect(ev.verdict).not.toBe('deal');
    expect(evaluate(e({ settings: { minProfit: 1500 } }), listing({ key: 'junk cap', price: 8000 }))).toMatchObject({ verdict: 'deal', npcFlip: true, profit: 2000 });
  });

  it('is not a deal when the listing costs more than an NPC pays', () => {
    expect(evaluate(e(), listing({ key: 'junk cap', price: 12000 }))).toMatchObject({ npcFlip: false, npc: 10000 });
  });

  it('stays an ordinary deal, with its own profit, when the usual price already makes it one', () => {
    const ev = evaluate(e(), listing({ key: 'fine cape', price: 15000 }));   // 50% under 30,000; an NPC pays 10,000
    expect(ev).toMatchObject({ verdict: 'deal', npcFlip: false });
    expect(ev.profit).toBe(Math.round(30000 * 0.97 - 15000));
  });

  it('is a deal from the NPC price alone when there is no market price', () => {
    expect(evaluate(e(), listing({ key: 'plain gloves', price: 1000 }))).toMatchObject({ verdict: 'deal', npcFlip: true, usual: null, npc: 4000, profit: 3000 });
  });

  it('counts a stack: an NPC pays for every one', () => {
    const ev = evaluate(e(), listing({ key: 'junk cap', qty: 5, price: 25000 }));   // 5 × 10,000 − 25,000
    expect(ev).toMatchObject({ npcFlip: true, profit: 25000 });
  });

  it('does not depend on the stats of the copy', () => {
    const tip: TooltipRead = { key: 'junk cap', name: 'Junk Cap', type: 'Hat', remaining: 3, stats: [{ label: 'att', weight: 1, total: 50, base: 60, delta: -10 }] };
    const ev = evaluate(e(), { ...listing({ key: 'junk cap', price: 4000 }), tip });
    expect(ev.npc).toBe(10000);
    expect(ev).toMatchObject({ npcFlip: true, profit: 6000 });
  });

  it('is ignored for a row read doubtfully, a sold row and a set', () => {
    expect(evaluate(e(), listing({ key: 'junk cap', price: 4000, unsure: true })).npcFlip).toBe(false);
    expect(evaluate(e(), listing({ key: 'junk cap', price: 4000, greyed: true }))).toMatchObject({ verdict: 'sold', npcFlip: false });
    expect(evaluate(e(), listing({ key: 'wolbi throwing stars', price: 100, set: true, qty: 800, units: 1, unit: 100 }))).toMatchObject({ npc: null, npcFlip: false });
  });

  it('does nothing for an item no NPC shop sells, or when turned off', () => {
    expect(evaluate(e(), listing({ key: 'free hat', price: 100 }))).toMatchObject({ npc: null, npcFlip: false });
    expect(evaluate(e({ settings: { npcRatio: 0 } }), listing({ key: 'junk cap', price: 4000 }))).toMatchObject({ npc: null, npcFlip: false });
    // and nothing changes for the items the other tests use
    expect(evaluate(engine(), listing({ key: 'traus', price: 40000 })).npc).toBeNull();
  });

  it('alerts like any deal, and says why', () => {
    const en = e();
    const deals: string[] = [];
    const s = new ShopSession(en, { onDeal: (d) => deals.push(d.name) });
    s.read([{ name: 'Junk Cap', truncated: false, nameConf: 95, cy: null, qty: 1, price: 4000, greyed: false, unsure: false }], false);
    expect(deals).toEqual(['Junk Cap']);
    const d = s.deals[0]!;
    expect(dealLine({ ...d, npcFlip: false }, en.market).profitNote).toBe('after fee');
    expect(dealLine(d, en.market)).toMatchObject({ why: 'an NPC pays 10,000 each for it', profit: '+6,000', profitNote: 'selling to an NPC' });
  });

  it('shows what the NPC pays under the usual price', () => {
    const en = e();
    const s = new ShopSession(en);
    s.read([{ name: 'Junk Cap', truncated: false, nameConf: 95, cy: null, qty: 1, price: 4000, greyed: false, unsure: false },
      { name: 'Free Hat', truncated: false, nameConf: 95, cy: null, qty: 1, price: 400, greyed: false, unsure: false }], false);
    const rows = s.displayRows();
    const cap = shopRowHtml(rows.find((r) => r.name === 'Junk Cap')!, en.market), hat = shopRowHtml(rows.find((r) => r.name === 'Free Hat')!, en.market);
    expect(cap).toContain('<span class="sub">NPC 10,000</span>');
    expect(cap).toContain('An NPC pays 10,000 each for it, more than this listing costs.');
    expect(hat).not.toContain('NPC');
  });
});

describe('an item in the appraisal and an NPC', () => {
  const en = e();
  const line = (name: string, qty = 1, over = {}) => appraiseEntry(en, { ...entryFor(en, name, qty), ...over }, 'fair');

  it('is worth what an NPC pays when nothing else prices it, marked as a floor', () => {
    expect(line('Plain Gloves', 2)).toMatchObject({ unit: 4000, src: 'npc', tag: 'rough', total: 8000, npc: 4000 });
  });

  it('is worth at least that, when the market price is lower', () => {
    expect(line('Junk Cap')).toMatchObject({ unit: 10000, src: 'npc', total: 10000 });   // market says 3,000
  });

  it('keeps the market price when it is higher', () => {
    expect(line('Fine Cape')).toMatchObject({ unit: 30000, src: 'market', tag: 'priced', npc: 10000 });
  });

  it('lifts a price that stats brought down, not one the person typed', () => {
    const tip: TooltipRead = { key: 'fine cape', name: 'Fine Cape', type: 'Cape', remaining: 0, stats: [{ label: 'att', weight: 1, total: 20, base: 60, delta: -40 }] };
    expect(line('Fine Cape', 1, { tip })).toMatchObject({ unit: 10000, src: 'npc' });   // 30,000 × 0.25 would be 7,500
    expect(line('Junk Cap', 1, { price: 500 })).toMatchObject({ unit: 500, src: 'line', npc: 10000 });
  });

  it('does not apply to a set, to an item no NPC shop sells, or when turned off', () => {
    expect(line('Wolbi Throwing Stars', 2)).toMatchObject({ unit: 2499, src: 'market', npc: null });
    expect(line('Free Hat')).toMatchObject({ unit: 500, npc: null });
    const off = appraiseEntry(e({ settings: { npcRatio: 0 } }), entryFor(en, 'Plain Gloves'), 'fair');
    expect(off).toMatchObject({ unit: null, tag: 'unpriced', npc: null });
  });

  it('is the same in every appraisal mode', () => {
    expect(appraiseEntry(en, entryFor(en, 'Plain Gloves'), 'greedy')).toMatchObject({ unit: 4000, src: 'npc' });
  });

  it('shows what the NPC pays, and where the price came from', () => {
    const html = appraisalRowHtml(line('Plain Gloves'), en.market);
    expect(html).toContain('NPC pays 4,000');
    expect(html).toContain('<span class="sub">NPC price</span>');
    expect(html).toContain('what an NPC pays for it: the least it is worth');
    expect(appraisalRowHtml(line('Free Hat'), en.market)).not.toContain('NPC');
  });
});

describe('the market line', () => {
  it('says how many items have an NPC price, or asks for the page again', () => {
    expect(marketInfo(e().market, NOW)).toContain('6 have an NPC shop price.');
    const none = market();   // the other tests' items have no NPC shop price
    expect(marketInfo(none, NOW)).toContain('No NPC prices: load the tracker page again to get them.');
    expect(none.withNpc).toBe(0);
  });
});
