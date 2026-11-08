import { describe, expect, it } from 'vitest';
import { appraise, appraiseEntry, AS_ADDED, cleanAppraisalSort, nextAppraisalSort, sortLines } from '../src/appraisal/appraise';
import { addEntry, cleanEntries, clampQty, entryFor, MAX_QTY, parseAppraisalLines } from '../src/appraisal/entries';
import { quoteFull, quoteShort } from '../src/appraisal/quote';
import { DEFAULT_SETTINGS, type AppraisalEntry, type TooltipRead } from '../src/lib/types';
import { Storage } from '../src/store/storage';
import { AppraisalPanel } from '../src/ui/appraisalPanel';
import { engine, NOW } from './helpers/market';

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

  it('applies hovered stats like the shop does, and they settle a rough price', () => {
    const l = appraiseEntry(e, entry('Traus', 1, { tip: trausTip }), 'fair');
    expect(l).toMatchObject({ unit: 46200, total: 46200, tag: 'priced' });   // 55,000 × 0.84
    expect(l.stats?.summary).toBe('−2 att, 7 slots left');
    expect(appraiseEntry(e, entry('Korean Fan'), 'fair').tag).toBe('rough');
    const fanTip: TooltipRead = { key: 'korean fan', name: 'Korean Fan', type: 'Fan', remaining: 7, stats: [] };
    expect(appraiseEntry(e, entry('Korean Fan', 1, { tip: fanTip }), 'fair').tag).toBe('priced');
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

describe('quote', () => {
  const lines = [entry('Gloves Attack Scroll: Greater', 2), entry('Lemona'), entry('Mystery Thing', 3), entry('Traus', 1, { ignored: true })];

  it('is one line for the chat', () => {
    expect(quoteShort(appraise(e, lines, 'fair', 100))).toBe('3 kinds / 6 items = 881,000 mesos (1 not priced)');
    expect(quoteShort(appraise(e, lines, 'fair', 90))).toBe('3 kinds / 6 items = 792,900 mesos (1 not priced)');
    expect(quoteShort(appraise(e, [entry('Lemona')], 'fair'))).toBe('1 kind / 1 item = 21,000 mesos');
    expect(quoteShort(appraise(e, [], 'fair'))).toBe('Nothing to appraise yet');
  });

  it('lists every counted line for pasting', () => {
    expect(quoteFull(appraise(e, lines, 'fair', 100))).toBe([
      'Appraisal (fair prices)', 'Gloves Attack Scroll: Greater ×2 = 860,000', 'Lemona ×1 = 21,000', 'Mystery Thing ×3 = not priced', 'Total 881,000',
    ].join('\n'));
    expect(quoteFull(appraise(e, lines, 'greedy', 90)).split('\n')).toEqual([
      'Appraisal (greedy prices, offer 90%)', 'Gloves Attack Scroll: Greater ×2 = 860,000', 'Lemona ×1 = 21,000', 'Mystery Thing ×3 = not priced', 'Total 881,000 · offer 90% = 792,900',
    ]);
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

describe('AppraisalPanel', () => {
  const panel = (over: Record<string, unknown>) => {
    const en = engine();
    Object.assign(en.settings, over);
    const st = new Storage(null);
    return { en, p: new AppraisalPanel({ engine: en, store: st, failed: new Set(), region: () => null, canScan: () => true, onMark: () => {}, onScan: () => {} }) };
  };

  it('starts empty and keeps good settings', () => {
    const { en, p } = panel({ appraisalMode: 'greedy', bulkOffer: 85 });
    expect(p.result()).toMatchObject({ mode: 'greedy', bulk: 85, total: 0, kinds: 0 });
    expect(en.settings).toMatchObject({ appraisalMode: 'greedy', bulkOffer: 85 });
  });

  it('falls back to the defaults when saved settings are nonsense', () => {
    const { en } = panel({ appraisalMode: 'cheap', bulkOffer: NaN });
    expect(en.settings).toMatchObject({ appraisalMode: DEFAULT_SETTINGS.appraisalMode, bulkOffer: DEFAULT_SETTINGS.bulkOffer });
    expect(panel({ appraisalMode: 'nope', bulkOffer: -5 }).en.settings).toMatchObject({ appraisalMode: 'fair', bulkOffer: 100 });
    expect(panel({ appraisalArea: 'everywhere' }).en.settings.appraisalArea).toBe('any');
  });

  it('counts hovers anywhere, or only near the marked area once one is chosen', () => {
    const region = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const en = engine(), st = new Storage(null);
    const p = new AppraisalPanel({ engine: en, store: st, failed: new Set(), region: () => region, canScan: () => true, onMark: () => {}, onScan: () => {} });
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

  it('starts paused, and scanning needs something to scan', () => {
    const en = engine(), st = new Storage(null);
    let on: boolean | null = null;
    const p = new AppraisalPanel({ engine: en, store: st, failed: new Set(), region: () => null, canScan: () => false, onMark: () => {}, onScan: (v) => { on = v; } });
    expect(p.scanning).toBe(false);
    expect(on).toBeNull();
  });
});

describe('ordering the lines', () => {
  // added in this order; Traus is skipped, Mystery Thing has no price
  const lines = () => appraise(e, [
    entry('Lemona'), entry('Gloves Attack Scroll: Greater', 2), entry('Mystery Thing', 3), entry('Traus', 1, { ignored: true }),
    entry('Wolbi Throwing Stars', 10), entry('Gloves Attack Scroll: Intermediate'),
  ], 'fair').lines;
  const order = (sort?: Parameters<typeof sortLines>[1]) => sortLines(lines(), sort).map((l) => l.name);

  it('keeps the order the lines were added in by default', () => {
    expect(order()).toEqual(['Lemona', 'Gloves Attack Scroll: Greater', 'Mystery Thing', 'Traus', 'Wolbi Throwing Stars', 'Gloves Attack Scroll: Intermediate']);
    expect(order(AS_ADDED)).toEqual(order());
  });

  it('puts the most valuable first, then the unpriced, then the skipped', () => {
    expect(order({ col: 'total', dir: -1 })).toEqual(['Gloves Attack Scroll: Intermediate', 'Gloves Attack Scroll: Greater', 'Wolbi Throwing Stars', 'Lemona', 'Mystery Thing', 'Traus']);
    expect(order({ col: 'total', dir: 1 })).toEqual(['Lemona', 'Wolbi Throwing Stars', 'Gloves Attack Scroll: Greater', 'Gloves Attack Scroll: Intermediate', 'Mystery Thing', 'Traus']);
  });

  it('orders by name, quantity and price each', () => {
    expect(order({ col: 'name', dir: 1 })).toEqual(['Gloves Attack Scroll: Greater', 'Gloves Attack Scroll: Intermediate', 'Lemona', 'Mystery Thing', 'Wolbi Throwing Stars', 'Traus']);
    expect(order({ col: 'name', dir: -1 })).toEqual(['Wolbi Throwing Stars', 'Mystery Thing', 'Lemona', 'Gloves Attack Scroll: Intermediate', 'Gloves Attack Scroll: Greater', 'Traus']);
    // ties (Lemona and Intermediate are one each) keep the order they were added in
    expect(order({ col: 'qty', dir: -1 })).toEqual(['Wolbi Throwing Stars', 'Mystery Thing', 'Gloves Attack Scroll: Greater', 'Lemona', 'Gloves Attack Scroll: Intermediate', 'Traus']);
    expect(order({ col: 'unit', dir: -1 })).toEqual(['Gloves Attack Scroll: Intermediate', 'Gloves Attack Scroll: Greater', 'Lemona', 'Wolbi Throwing Stars', 'Mystery Thing', 'Traus']);
  });

  it('keeps skipped lines last whichever way a column runs', () => {
    for (const col of ['name', 'qty', 'unit', 'total'] as const) for (const dir of [1, -1] as const) {
      expect(order({ col, dir }).at(-1), `${col} ${dir}`).toBe('Traus');
    }
  });

  it('leaves the lines it was given alone, and the totals the same in any order', () => {
    const given = lines();
    const before = given.map((l) => l.name);
    sortLines(given, { col: 'total', dir: -1 });
    expect(given.map((l) => l.name)).toEqual(before);
    const r = appraise(e, [entry('Lemona'), entry('Gloves Attack Scroll: Greater', 2)], 'fair');
    expect(sortLines(r.lines, { col: 'total', dir: -1 }).map((l) => l.total)).toEqual([860000, 21000]);
    expect(r.total).toBe(881000);
  });

  it('chooses a column: the same one flips, another starts the way that suits it', () => {
    expect(nextAppraisalSort(AS_ADDED, 'total')).toEqual({ col: 'total', dir: -1 });
    expect(nextAppraisalSort({ col: 'total', dir: -1 }, 'total')).toEqual({ col: 'total', dir: 1 });
    expect(nextAppraisalSort({ col: 'total', dir: -1 }, 'name')).toEqual({ col: 'name', dir: 1 });
    expect(nextAppraisalSort(AS_ADDED, 'qty')).toEqual({ col: 'qty', dir: -1 });
    expect(nextAppraisalSort(AS_ADDED, 'unit')).toEqual({ col: 'unit', dir: -1 });
  });

  it('takes the order lines were added in for a saved choice it cannot read', () => {
    expect(cleanAppraisalSort('total', -1)).toEqual({ col: 'total', dir: -1 });
    expect(cleanAppraisalSort('total', 'down')).toEqual({ col: 'total', dir: 1 });
    expect(cleanAppraisalSort('price', -1)).toEqual(AS_ADDED);
    expect(cleanAppraisalSort(undefined, undefined)).toEqual(AS_ADDED);
  });

  it('puts the copied list in the same order', () => {
    const r = appraise(e, [entry('Lemona'), entry('Gloves Attack Scroll: Greater', 2)], 'fair');
    r.lines = sortLines(r.lines, { col: 'total', dir: -1 });
    expect(quoteFull(r).split('\n')[1]).toBe('Gloves Attack Scroll: Greater ×2 = 860,000');
  });

  it('is part of the saved settings, and a panel falls back when they are nonsense', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ appraisalSort: 'added', appraisalSortDir: 1 });
    const mk = (over: Record<string, unknown>) => {
      const en = engine();
      Object.assign(en.settings, over);
      const p = new AppraisalPanel({ engine: en, store: new Storage(null), failed: new Set(), region: () => null, canScan: () => true, onMark: () => {}, onScan: () => {} });
      p.importEntries([{ id: 'a', key: 'lemona', name: 'Lemona', qty: 1 }, { id: 'b', key: 'gloves attack scroll greater', name: 'Gloves Attack Scroll: Greater', qty: 2 }]);
      return p;
    };
    expect(mk({ appraisalSort: 'total', appraisalSortDir: -1 }).result().lines.map((l) => l.name)).toEqual(['Gloves Attack Scroll: Greater', 'Lemona']);
    expect(mk({ appraisalSort: 'nope', appraisalSortDir: -1 }).sort()).toEqual(AS_ADDED);
    expect(mk({ appraisalSort: 'nope' }).result().lines.map((l) => l.name)).toEqual(['Lemona', 'Gloves Attack Scroll: Greater']);
  });
});
