import { describe, expect, it } from 'vitest';
import { appraise, appraiseEntry, listPrice, needsCount, storeTotal } from '../src/appraisal/appraise';
import { addEntry, cleanEntries, clampQty, entryFor, MAX_QTY, parseAppraisalLines } from '../src/appraisal/entries';
import { offerText, storePricesText } from '../src/appraisal/quote';
import { DEFAULT_SETTINGS, type AppraisalEntry, type TooltipRead } from '../src/lib/types';
import { Storage } from '../src/store/storage';
import { InventoryView } from '../src/ui/inventoryView';
import { engine, FACTS, ITEMS, NOW } from './helpers/market';

const e = engine({ settings: { appraisalMode: 'fair' } });
const entry = (name: string, qty = 1, o: Partial<AppraisalEntry> = {}): AppraisalEntry => ({ ...entryFor(e, name, qty), ...o });
const seen = (...units: number[]) => units.map((u, i): [number, number, number] => [NOW - (i + 1) * 3600e3, u, 1]);

/** Traus's tooltip: 2 attack under base, no slot used. */
const trausTip: TooltipRead = {
  key: 'traus', name: 'Traus', type: 'One-handed Sword', remaining: 7,
  stats: [{ label: 'att', weight: 1, total: 58, base: 60, delta: -2 }],
};

describe('appraise', () => {
  it('adds up the lines, and offers a percentage of the total', () => {
    const r = appraise(e, [
      entry('Gloves Attack Scroll: Intermediate', 2), entry('Gloves Attack Scroll: Greater'), entry('Lemona'), entry('Wolbi Throwing Stars', 2),
    ], 'fair', 90);
    expect(r.lines.map((l) => l.total)).toEqual([2199998, 430000, 21000, 4998]);
    expect(r).toMatchObject({ total: 2655996, rough: 0, unpriced: 0, ignored: 0, kinds: 4, items: 6, bulk: 90, quote: 2390396 });
    expect(r.lines.every((l) => l.tag === 'priced' && l.src === 'market')).toBe(true);
  });

  it('prices throwing stars per set, whatever the count in the stack', () => {
    const l = appraiseEntry(e, entry('Wolbi Throwing Stars', 2), 'fair');
    expect(l).toMatchObject({ set: true, unit: 2499, total: 4998 });
    expect(appraiseEntry(e, entry('Lemona', 2), 'fair').set).toBe(false);
  });

  it('counts rough prices but marks them, and leaves unpriced and ignored lines out', () => {
    const r = appraise(e, [
      entry('Korean Fan'), entry('Gloves Attack Scroll: Chaos'), entry('Unsold Cape', 2), entry('Mystery Thing'), entry('Lemona', 1, { ignored: true }),
    ], 'fair');
    expect(r.lines.map((l) => l.tag)).toEqual(['rough', 'rough', 'unpriced', 'unpriced', 'ignored']);
    expect(r).toMatchObject({ total: 68888 + 1844444, rough: 68888 + 1844444, unpriced: 2, ignored: 1, kinds: 4, items: 5 });
    expect(r.lines[3]).toMatchObject({ known: false, unit: null, total: null, src: null });
  });

  it('reads the same item differently in each mode', () => {
    const book = { items: { traus: { name: 'Traus', manualRef: null, buyUnder: null, s: seen(80000, 81000, 82000, 83000) } } };
    const eg = engine({ book });
    expect(appraiseEntry(eg, entryFor(eg, 'Traus', 2), 'fair')).toMatchObject({ unit: 55000, total: 110000, src: 'market' });
    expect(appraiseEntry(eg, entryFor(eg, 'Traus', 2), 'greedy')).toMatchObject({ unit: 82250, total: 164500, src: 'seen' });
  });

  it('lets a price typed on the line beat every mode', () => {
    const l = appraiseEntry(e, entry('Unsold Cape', 4, { price: 500 }), 'greedy');
    expect(l).toMatchObject({ unit: 500, total: 2000, src: 'line', tag: 'priced' });
    expect(appraiseEntry(e, entry('Traus', 1, { price: 1000, tip: trausTip }), 'fair')).toMatchObject({ unit: 1000, stats: null });
  });

  it('applies hovered stats like the shop does', () => {
    const l = appraiseEntry(e, entry('Traus', 1, { tip: trausTip }), 'fair');
    expect(l).toMatchObject({ unit: 46200, total: 46200, tag: 'priced' });   // 55,000 × 0.84
    expect(l.stats?.summary).toBe('−2 att, 7 slots left');
  });

  it('lets hovered stats settle "copies sell for very different prices" only, as the shop does', () => {
    /** Traus with the tracker's flags: `w` copies sell for very different prices, `l` fewer than 5 sales. */
    const flagged = (f: string) => engine({ settings: { appraisalMode: 'fair' }, items: ITEMS.map((it) => (it.n === 'Traus' ? { ...it, f } : it)) });
    const tag = (f: string, tip?: TooltipRead) => appraiseEntry(flagged(f), entry('Traus', 1, tip && { tip }), 'fair').tag;
    expect(['w', 'l', 'lw'].map((f) => tag(f))).toEqual(['rough', 'rough', 'rough']);
    expect(['w', 'l', 'lw'].map((f) => tag(f, trausTip))).toEqual(['priced', 'rough', 'rough']);
    const blank: TooltipRead = { ...trausTip, stats: [], remaining: null };   // an equip whose tooltip showed nothing to read
    expect(tag('w', blank)).toBe('rough');
    expect(appraise(flagged('l'), [entry('Traus', 1, { tip: trausTip }), entry('Lemona')], 'fair')).toMatchObject({ total: 46200 + 21000, rough: 46200 });
  });

  it("reads the base and the slots from the game data when it has the item's", () => {
    const tip: TooltipRead = { key: 'traus', name: 'Traus', type: '', remaining: 7, stats: [{ label: 'att', weight: 1, total: 58, base: 58, delta: 0 }] };
    expect(appraiseEntry(e, entry('Traus', 1, { tip }), 'fair').stats?.summary).toBe('average stats, 7 slots left');
    const l = appraiseEntry(engine({ settings: { appraisalMode: 'fair' }, facts: FACTS }), entry('Traus', 1, { tip }), 'fair');
    expect(l.stats?.summary).toBe('−2 att, 7 slots left');
    expect(l.unit).toBe(46200);
  });

  it('uses your typed price from the price book, in every mode', () => {
    const book = { items: { lemona: { name: 'Lemona', manualRef: 30000, buyUnder: null, s: [] } } };
    const eb = engine({ book });
    for (const m of ['fair', 'greedy'] as const) expect(appraiseEntry(eb, entryFor(eb, 'Lemona'), m)).toMatchObject({ unit: 30000, src: 'yours' });
  });

  it('is empty and zero with nothing in it', () => {
    expect(appraise(e, [], 'fair')).toMatchObject({ total: 0, quote: 0, kinds: 0, items: 0 });
  });
});

describe('entries', () => {
  it("files a name under the item it means, in the tracker's spelling", () => {
    expect(entryFor(e, '  gloves attack scroll: CHAOS ', 2)).toMatchObject({ key: 'gloves attack scroll chaos', name: 'Gloves Attack Scroll: Chaos', qty: 2 });
    expect(entryFor(e, 'Mystery Thing')).toMatchObject({ key: 'mystery thing', name: 'Mystery Thing', qty: 1 });
  });

  it('merges the same item with the same stats and price, and keeps different ones apart', () => {
    const list: AppraisalEntry[] = [];
    addEntry(list, entryFor(e, 'Lemona', 2));
    const again = addEntry(list, entryFor(e, 'Lemona', 3));
    expect(list).toHaveLength(1);
    expect(again.qty).toBe(5);
    addEntry(list, entryFor(e, 'Traus', 1, trausTip));
    addEntry(list, entryFor(e, 'Traus', 1, { ...trausTip, stats: [{ label: 'att', weight: 1, total: 60, base: 60, delta: 0 }] }));
    addEntry(list, entryFor(e, 'Traus', 1, trausTip));
    expect(list.map((x) => [x.key, x.qty])).toEqual([['lemona', 5], ['traus', 2], ['traus', 1]]);
    addEntry(list, { ...entryFor(e, 'Lemona'), price: 99 });
    addEntry(list, { ...entryFor(e, 'Lemona'), ignored: true });
    expect(list).toHaveLength(5);
  });

  it('keeps a count a whole number, at least 1 and not absurd', () => {
    expect([clampQty(0), clampQty(-4), clampQty(2.9), clampQty(NaN), clampQty(1e12)]).toEqual([1, 1, 2, 1, MAX_QTY]);
  });

  it('reads names with a count in the usual ways', () => {
    const { ok, bad } = parseAppraisalLines([
      'Cape INT Scroll: Lesser x3', '3 x Lemona', '12× Red Potion', 'Lemona, 12', 'Wolbi Throwing Stars ×2', 'Shoes Speed Scroll: Chaos: 5', 'Traus', '  ', '12345', '!!',
    ].join('\n'));
    expect(ok).toEqual([
      { name: 'Cape INT Scroll: Lesser', qty: 3 }, { name: 'Lemona', qty: 3 }, { name: 'Red Potion', qty: 12 }, { name: 'Lemona', qty: 12 },
      { name: 'Wolbi Throwing Stars', qty: 2 }, { name: 'Shoes Speed Scroll: Chaos', qty: 5 }, { name: 'Traus', qty: 1 },
    ]);
    expect(bad).toEqual(['12345', '!!']);
  });

  it('keeps a name that merely ends in x', () => {
    expect(parseAppraisalLines('Onyx').ok).toEqual([{ name: 'Onyx', qty: 1 }]);
    expect(parseAppraisalLines('Pet Box x2').ok).toEqual([{ name: 'Pet Box', qty: 2 }]);
  });

  it('drops what storage or a backup holds that is not an entry', () => {
    const clean = cleanEntries([
      { id: 'a', key: 'lemona', name: 'Lemona', qty: 2.7, price: 5, ignored: true }, { key: 'traus', name: 'Traus', qty: 'x' },
      null, 5, { name: 'no key', qty: 1 }, { key: 'k', name: 3, qty: 1 }, { key: 'bad tip', name: 'Bad Tip', qty: 1, tip: { stats: 'no' } },
    ]);
    expect(clean.map((x) => [x.key, x.qty, x.price ?? null, !!x.ignored])).toEqual([['lemona', 2, 5, true], ['traus', 1, null, false], ['bad tip', 1, null, false]]);
    expect(clean[0]!.id).toBe('a');
    expect(clean[1]!.id).toMatch(/\w+/);
    expect(cleanEntries(undefined)).toEqual([]);
    expect(cleanEntries({})).toEqual([]);
  });
});

describe('the offer and the store prices, as copied', () => {
  const lines = [entry('Gloves Attack Scroll: Greater', 2), entry('Lemona'), entry('Mystery Thing', 3), entry('Traus', 1, { ignored: true })];

  it('offers everything in one line for the chat', () => {
    expect(offerText(appraise(e, lines, 'fair', 100))).toBe('6 items for 881,000 mesos (1 not priced)');
    expect(offerText(appraise(e, lines, 'fair', 90))).toBe('6 items for 792,900 mesos (1 not priced)');
    expect(offerText(appraise(e, [entry('Lemona')], 'fair'))).toBe('1 item for 21,000 mesos');
    expect(offerText(appraise(e, [], 'fair'))).toBe('No items yet');
  });

  it('lists what to type in the store, one line per item in the order added, skipped ones left out', () => {
    expect(storePricesText(appraise(e, lines, 'fair'), 0)).toBe([
      'Gloves Attack Scroll: Greater ×2: 430,000', 'Lemona ×1: 21,000', 'Mystery Thing ×3: no price',
    ].join('\n'));
    expect(storePricesText(appraise(e, lines, 'fair'), 5).split('\n').slice(0, 2)).toEqual(['Gloves Attack Scroll: Greater ×2: 451,500', 'Lemona ×1: 22,050']);
    expect(storePricesText(appraise(e, [], 'fair'), 0)).toBe('');
  });

  it('says nothing of appraising anywhere a player reads it', () => {
    const r = appraise(e, lines, 'greedy', 90);
    for (const text of [offerText(r), storePricesText(r, 0), offerText(appraise(e, [], 'fair'))]) expect(text).not.toMatch(/apprais|kind/i);
  });
});

describe('List at', () => {
  const line = (name: string, o: Partial<AppraisalEntry> = {}) => appraiseEntry(e, entry(name, 1, o), 'fair');

  it("is the item's price moved by the List at percent, in whole mesos", () => {
    expect(listPrice(line('Lemona'), 0)).toBe(21000);
    expect(listPrice(line('Lemona'), 5)).toBe(22050);
    expect(listPrice(line('Lemona'), -10)).toBe(18900);
    expect(listPrice(line('Gloves Attack Scroll: Intermediate'), 3)).toBe(1132999);   // 1,099,999 × 1.03 = 1,132,998.97
    expect(listPrice(line('Tobi Throwing Stars'), 1)).toBe(1868500);
  });

  it('rounds small prices to whole mesos, never under 1', () => {
    expect(listPrice(line('Arrows for Bows'), 5)).toBe(5);   // 5.25
    expect(listPrice(line('Arrows for Bows'), 10)).toBe(6);  // 5.5
    expect(listPrice(line('Arrows for Bows'), -50)).toBe(3); // 2.5
    expect(listPrice({ ...line('Arrows for Bows'), unit: 0.4 }, 0)).toBe(1);
  });

  it('is a price typed on the line as it is, and nothing for a line with no price', () => {
    expect(listPrice(line('Lemona', { price: 25000 }), 5)).toBe(25000);
    expect(listPrice(line('Mystery Thing'), 5)).toBeNull();
    expect(listPrice(line('Mystery Thing', { price: 900 }), 5)).toBe(900);
  });
});

describe('the two totals', () => {
  it('adds the worth at the chosen price, and what the store asks at List at × count', () => {
    const r = appraise(e, [entry('Lemona', 2), entry('Gloves Attack Scroll: Greater', 3), entry('Mystery Thing', 4), entry('Traus', 1, { ignored: true })], 'fair');
    expect(r.total).toBe(2 * 21000 + 3 * 430000);
    expect(storeTotal(r, 0)).toBe(r.total);
    expect(storeTotal(r, 5)).toBe(2 * 22050 + 3 * 451500);
    // a typed price is the line's worth and its List at price, unmoved
    const typed = appraise(e, [entry('Lemona', 2, { price: 30000 }), entry('Mystery Thing', 1, { price: 1000 })], 'fair');
    expect(typed.total).toBe(61000);
    expect(storeTotal(typed, 20)).toBe(61000);
    expect(storeTotal(appraise(e, [], 'fair'), 5)).toBe(0);
  });

  it('follows the chosen price', () => {
    const book = { items: { traus: { name: 'Traus', manualRef: null, buyUnder: null, s: seen(80000, 81000, 82000, 83000) } } };
    const en = engine({ book });
    const r = (mode: 'fair' | 'greedy') => appraise(en, [entryFor(en, 'Traus', 2)], mode);
    expect([r('fair').total, storeTotal(r('fair'), 10)]).toEqual([110000, 121000]);
    expect([r('greedy').total, storeTotal(r('greedy'), 10)]).toEqual([164500, 180950]);
  });
});

describe('need a count', () => {
  const need = (name: string, qty = 1, o: Partial<AppraisalEntry> = {}) => needsCount(appraiseEntry(e, entry(name, qty, o), 'fair'));

  it('is a stack whose count is still the 1 it started at', () => {
    expect(need('Gloves Attack Scroll: Greater')).toBe(true);
    expect(need('Mystery Thing')).toBe(true);
    expect(need('Gloves Attack Scroll: Greater', 3)).toBe(false);
  });

  it('is a stack holding a hovered slot whose number was not read, whatever its count', () => {
    expect(need('Gloves Attack Scroll: Greater', 2, { unsure: true })).toBe(true);
  });

  it('is never an equip, a skipped line, or a count you typed', () => {
    expect(need('Lemona')).toBe(false);
    expect(need('Traus')).toBe(false);
    expect(need('Gloves Attack Scroll: Greater', 1, { ignored: true })).toBe(false);
    expect(need('Gloves Attack Scroll: Greater', 1, { counted: true })).toBe(false);
    // an item the tracker doesn't know is an equip when its tooltip had stats
    expect(need('Odd Sword', 1, { tip: { ...trausTip, key: 'odd sword', name: 'Odd Sword' } })).toBe(false);
  });

  it('keeps the counted mark through storage', () => {
    expect(cleanEntries([{ id: 'a', key: 'red potion', name: 'Red Potion', qty: 3, counted: true }])[0]!.counted).toBe(true);
    expect(cleanEntries([{ id: 'a', key: 'red potion', name: 'Red Potion', qty: 3 }])[0]!.counted).toBeUndefined();
  });

  it('takes a stack saved at 1 as counted, so items saved before the mark existed do not all ask for a count', () => {
    const saved = cleanEntries([
      { id: 'a', key: 'red potion', name: 'Red Potion', qty: 1 },
      { id: 'b', key: 'leaf', name: 'Leaf', qty: 1, unsure: true },   // a hovered slot whose number was not read: still asked
      { id: 'c', key: 'gloves attack scroll: greater', name: 'Gloves Attack Scroll: Greater', qty: 4 },
    ]);
    expect(saved.map((x) => x.counted)).toEqual([true, undefined, undefined]);
    expect(saved.map((x) => needsCount(appraiseEntry(e, x, 'fair')))).toEqual([false, true, false]);
  });
});

describe('Storage', () => {
  const memory = (): globalThis.Storage => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as globalThis.Storage;
  };

  it('round-trips an appraisal and the settings that go with it', () => {
    const ls = memory(), st = new Storage(ls);
    const entries = [entry('Lemona', 3), entry('Traus', 1, { tip: trausTip, ignored: true })];
    expect(st.saveAppraisal({ entries })).toBe(true);
    expect(new Storage(ls).loadAppraisal()).toEqual({ entries });
    expect(st.saveSettings({ ...DEFAULT_SETTINGS, appraisalMode: 'greedy', bulkOffer: 90 })).toBe(true);
    expect(new Storage(ls).loadSettings()).toMatchObject({ appraisalMode: 'greedy', bulkOffer: 90 });
  });

  it('starts empty, and takes old settings that lack the new ones', () => {
    const ls = memory(), st = new Storage(ls);
    expect(st.loadAppraisal()).toEqual({ entries: [] });
    ls.setItem('fmscan.v1.appraisal', '{broken');
    expect(st.loadAppraisal()).toEqual({ entries: [] });
    ls.setItem('fmscan.v1.settings', JSON.stringify({ discount: 30 }));
    expect(st.loadSettings()).toMatchObject({ discount: 30, appraisalMode: 'fair', bulkOffer: 100 });
  });
});

const VIEW_DEPS = {
  setScanning: () => false, shown: () => false, version: () => '', capturing: () => false, openPrices() {}, startCapture() {}, overlay() {},
};

describe('InventoryView', () => {
  const panel = (over: Record<string, unknown>) => {
    const en = engine();
    Object.assign(en.settings, over);
    const st = new Storage(null);
    return { en, p: new InventoryView({ engine: en, store: st, failed: new Set(), region: () => null, ...VIEW_DEPS }) };
  };

  it('starts empty and keeps good settings', () => {
    const { en, p } = panel({ appraisalMode: 'greedy', bulkOffer: 85 });
    expect(p.result()).toMatchObject({ mode: 'greedy', bulk: 85, total: 0, kinds: 0 });
    expect(en.settings).toMatchObject({ appraisalMode: 'greedy', bulkOffer: 85 });
  });

  it('counts hovers anywhere, or only near the marked area once one is chosen', () => {
    const region = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const en = engine(), st = new Storage(null);
    const p = new InventoryView({ engine: en, store: st, failed: new Set(), region: () => region, ...VIEW_DEPS });
    expect(p.area()).toBeNull();
    en.settings.appraisalArea = 'marked';
    expect(p.area()).toEqual(region);
  });

  it('adds the lines of a backup once, however often the file is imported', () => {
    const { p } = panel({});
    const lines = [{ id: 'a1', key: 'lemona', name: 'Lemona', qty: 2 }, { id: 'b2', key: 'red potion', name: 'Red Potion', qty: 84, unsure: true }];
    expect(p.importEntries(lines)).toBe(2);
    expect(p.importEntries(lines)).toBe(0);
    expect(p.entries().map((x) => [x.name, x.qty])).toEqual([['Lemona', 2], ['Red Potion', 84]]);
    expect(p.entries()[1]!.unsure).toBe(true);
    // the same item from another backup joins its line
    expect(p.importEntries([{ id: 'c3', key: 'lemona', name: 'Lemona', qty: 1 }])).toBe(1);
    expect(p.entries().map((x) => [x.name, x.qty])).toEqual([['Lemona', 3], ['Red Potion', 84]]);
  });

  it('starts paused', () => {
    expect(panel({}).p.scanning).toBe(false);
  });
});

describe('the order of your items', () => {
  it('is the order they were added in, whatever an old version saved', () => {
    const en = engine({ settings: { appraisalSort: 'total', appraisalSortDir: -1 } });
    const p = new InventoryView({ engine: en, store: new Storage(null), failed: new Set(), region: () => null, ...VIEW_DEPS });
    p.importEntries([{ id: 'a', key: 'lemona', name: 'Lemona', qty: 1 }, { id: 'b', key: 'gloves attack scroll greater', name: 'Gloves Attack Scroll: Greater', qty: 2 }]);
    expect(p.result().lines.map((l) => l.name)).toEqual(['Lemona', 'Gloves Attack Scroll: Greater']);
    // the old setting still loads, so the rest of an old file does
    expect(DEFAULT_SETTINGS).toMatchObject({ appraisalSort: 'added', appraisalSortDir: 1 });
  });
});
