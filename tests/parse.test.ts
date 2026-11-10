import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OcrLine } from '../src/lib/types';
import { cleanName, isGreyed, parseLines, priceGap, PRICE_RE } from '../src/listing/parseListing';
import { parseTooltip, statKind, statNumbers, type ResolveName } from '../src/tooltip/parseTooltip';
import { slotsForType, statSig, statValue } from '../src/tooltip/statValue';
import { resolveKey } from '../src/market/matching';
import { FIXTURES } from './helpers/image';
import { CATALOG, FACTS, market } from './helpers/market';

const lines = (name: string): OcrLine[] => JSON.parse(readFileSync(join(FIXTURES, 'ocr', `${name}.lines.json`), 'utf8')) as OcrLine[];
const line = (text: string, confidence = 95): OcrLine => ({ text, confidence });

describe('cleanName', () => {
  it('drops bits of the item icon read as text', () => {
    expect(cleanName('o] Korean Fan').name).toBe('Korean Fan');
    expect(cleanName('1| Red Potion').name).toBe('Red Potion');
    expect(cleanName('a Wolbi Throwing Stars').name).toBe('Wolbi Throwing Stars');
    expect(cleanName('» Dark Guardian\n').name).toBe('Dark Guardian');
  });
  it('drops whatever sits beyond a wide gap', () => {
    expect(cleanName('Traus        i').name).toBe('Traus');
  });
  it('notices a cut-off name', () => {
    expect(cleanName('Gloves Attack Scr..')).toEqual({ name: 'Gloves Attack Scr', truncated: true });
    expect(cleanName('Gloves Attack Scroll…')).toEqual({ name: 'Gloves Attack Scroll', truncated: true });
    expect(cleanName('Lemona').truncated).toBe(false);
  });
  it('keeps closing brackets and percentages', () => {
    expect(cleanName('Scroll for Gloves for ATT 60%').name).toBe('Scroll for Gloves for ATT 60%');
  });
});

describe('PRICE_RE', () => {
  it('tolerates the usual misreads', () => {
    for (const t of ['1 for 9,999 mesos', 'l tor 9,999 rnesos', '1 fon 9.999 mcsos', '50O for 2,999 mesos', '1for 99,999mesos']) {
      expect(t).toMatch(PRICE_RE);
    }
    expect('Bronze Chain Boots').not.toMatch(PRICE_RE);
  });
});

describe('parseLines', () => {
  it('reads every listing of a real shop', () => {
    const rows = parseLines(lines('shop-list.list'));
    expect(rows.map((r) => [r.name, r.qty, r.price, r.unsure])).toEqual([
      ['Dark Guardian', 1, 79999, false],
      ['Bronze Chain Boots', 1, 9999, false],
      ['Bronze Chain Boots', 1, 16999, false],
      ['Lemona', 1, 19999, false],
      ['Cape INT Scroll: Lesser', 1, 99999, false],
      ['Shoes Speed Scroll; Chaos', 1, 29999, false],
    ]);
    // each row's center, from its name line to its price line
    expect(rows[0]!.cy).toBeCloseTo((33 + 193) / 2, 0);
  });

  it('marks a price with hidden digits as unsure', () => {
    // the mouse covered ",999" of "99,999": the reader saw "99", confidently
    const rows = parseLines(lines('shop-list-digits-hidden.list'));
    const cape = rows.find((r) => r.name.startsWith('Cape'))!;
    expect(cape.price).toBe(99);
    expect(cape.unsure).toBe(true);
    expect(rows.filter((r) => r.unsure)).toHaveLength(1);
  });

  it('marks oddly grouped or low-confidence prices as unsure', () => {
    const rows = parseLines([line('Lemona'), line('1 for 1999,99 mesos'), line('Traus'), line('1 for 55,000 mesos', 50), line('Axe Pole Arm'), line('1 for 15,000 mesos')]);
    expect(rows.map((r) => r.unsure)).toEqual([true, true, false]);
  });

  it('reads O and l as digits and a dot as a thousands comma', () => {
    const rows = parseLines([line('Arrows for Bows'), line('l000 for 5.OOO mesos')]);
    expect(rows[0]).toMatchObject({ qty: 1000, price: 5000 });
  });

  it('ignores a price with no name above it, and junk names', () => {
    expect(parseLines([line('1 for 9,999 mesos')])).toEqual([]);
    expect(parseLines([line('|| :'), line('1 for 9,999 mesos')])).toEqual([]);
  });

  it('pairs a price only with the name right above it', () => {
    const rows = parseLines([line('Lemona'), line('1 for 19,999 mesos'), line('1 for 5 mesos')]);
    expect(rows).toHaveLength(1);
  });

  it('rejects impossible quantities', () => {
    expect(parseLines([line('Lemona'), line('99999 for 19,999 mesos')])).toEqual([]);
  });
});

describe('priceGap', () => {
  const words = (...ws: [string, number, number][]) => ({
    text: ws.map((w) => w[0]).join(' '), confidence: 90,
    words: ws.map(([text, x0, x1]) => ({ text, bbox: { x0, y0: 0, x1, y1: 50 } })),
  });
  it('sees a gap wider than about two characters inside the price', () => {
    expect(priceGap(words(['1', 0, 18], ['for', 50, 130], ['99', 150, 220], ['mesos', 400, 600]))).toBe(true);
    expect(priceGap(words(['1', 0, 18], ['for', 50, 130], ['99,999', 150, 370], ['mesos', 400, 600]))).toBe(false);
  });
  it('needs the words to judge', () => {
    expect(priceGap(line('1 for 99 mesos'))).toBe(false);
  });
});

describe('isGreyed', () => {
  const img = (v: number) => ({ gray: new Uint8Array(100 * 20).fill(v), w: 100, h: 20 });
  const l: OcrLine = { text: '1 for 9 mesos', confidence: 90, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 }, words: [{ text: '9', bbox: { x0: 10, y0: 0, x1: 60, y1: 20 } }] };
  it('tells sold (light grey text) from live (dark text)', () => {
    const live = img(230); live.gray.fill(20, 100 * 5 + 10, 100 * 5 + 40);
    expect(isGreyed(live, l)).toBe(false);
    const sold = img(230); sold.gray.fill(160, 100 * 5 + 10, 100 * 5 + 40);
    expect(isGreyed(sold, l)).toBe(true);
  });
});

/** Resolves names against a few items, like the matcher does against the tracker. */
const resolve: ResolveName = (name) => {
  const known: Record<string, string> = { traus: 'Traus', 'axe pole arm': 'Axe Pole Arm' };
  const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return { key, known: known[key] ?? null };
};

describe('parseTooltip', () => {
  it('reads a real Traus tooltip: a stray mark before the name, a misread minus', () => {
    const t = parseTooltip(lines('tooltip-traus.tooltip'), resolve)!;
    expect(t).toMatchObject({ key: 'traus', name: 'Traus', type: 'One-handed Sword', remaining: 7 });
    expect(t.stats).toEqual([{ label: 'att', weight: 1, total: 58, base: 60, delta: -2 }]);
  });

  it('reads a real Axe Pole Arm tooltip and skips the requirements', () => {
    const t = parseTooltip(lines('tooltip-axe-pole-arm.tooltip'), resolve)!;
    expect(t).toMatchObject({ key: 'axe pole arm', name: 'Axe Pole Arm', type: 'Polearm', remaining: 7 });
    expect(t.stats).toEqual([{ label: 'att', weight: 1, total: 62, base: 60, delta: 2 }]);
  });

  it('prefers a known name found by dropping a stray word in front', () => {
    const t = parseTooltip([line('F *Traus'), line('REQ LEV: 40'), line('Weapon Attack: +60')], resolve)!;
    expect(t.name).toBe('Traus');
  });

  it('keeps an unknown name as read', () => {
    const t = parseTooltip([line('Mystery Blade'), line('REQ LEV: 40'), line('Weapon Attack: +60')], resolve)!;
    expect(t).toMatchObject({ key: 'mystery blade', name: 'Mystery Blade' });
  });

  it('reads several stats, with and without a base in brackets', () => {
    const t = parseTooltip([
      line('Traus'), line('REQ STR: 120'), line('STR: +3 (2 +1)'), line('DEX: +2'), line('Weapon Attack: +61 (60 +1)'),
      line('Avoidability: +5 (6 -1)'), line('Speed: +4'), line('MaxHP: +30 (20 +10)'), line('Remaining Enhancements : 5'),
    ], resolve)!;
    expect(t.stats.map((s) => [s.label, s.total, s.base, s.delta])).toEqual([
      ['STR', 3, 2, 1], ['DEX', 2, 2, 0], ['att', 61, 60, 1], ['avoid', 5, 6, -1], ['speed', 4, 4, 0], ['HP', 30, 20, 10],
    ]);
    expect(t.remaining).toBe(5);
  });

  it('reads stat lines the reader garbled', () => {
    const t = parseTooltip([line('al* Axe Pole Arm'), line('FER STR : 75'), line('+ Attack Speed: Slow'),
      line('N Wieapon Attack: +62 (0 +2)'), line('#& Femaining Enhancements: 7')], resolve)!;
    expect(t.stats).toEqual([{ label: 'att', weight: 1, total: 62, base: 60, delta: 2, printed: { base: 0, diff: 2 } }]);
    expect(t.remaining).toBe(7);
  });

  it('keeps the bracket as printed when it disagrees with the total', () => {
    const t = parseTooltip([line('Traus'), line('REQ LEV: 40'), line('Weapon Attack: +68 (60 -2)'), line('Weapon Attack: +62 (60 +2)'),
      line('Weapon Attack: +62 (60 -2)')], resolve)!;
    // the second agrees; the third differs only by its sign, which the reader often gets wrong
    expect(t.stats.map((s) => s.printed)).toEqual([{ base: 60, diff: -2 }, undefined, undefined]);
  });

  it('reads a stat line whose colon the reader lost', () => {
    const t = parseTooltip([line('Traus'), line('REQ LEV: 40'), line('Weapon Attack +58 (60-2)'), line(':  Weapon Attack +62 (60 +2)'), line('Speed: Fast')], resolve)!;
    expect(t.stats.map((s) => [s.label, s.total, s.base])).toEqual([['att', 58, 60], ['att', 62, 60]]);
  });

  it('works out a base read as letters from the difference', () => {
    const t = parseTooltip([line('Traus'), line('REQ LEV: 40'), line('\u201cWeapon Attack: +58 (ED -2)')], resolve)!;
    expect(t.stats).toEqual([{ label: 'att', weight: 1, total: 58, base: 60, delta: -2 }]);
  });

  it("cleans up the name with the game's item list when the tracker doesn't list it", () => {
    const m = market([]).withCatalog(CATALOG);
    const byGame: ResolveName = (name) => { const key = resolveKey({ market: m, book: { items: {} } }, name, false); return { key, known: m.knownName(key) }; };
    for (const first of ['als Axe Pole Arm', 'al* Axe Pole Arm', 'a+ Axe Pole Arm', 'ds Axe Pole Arm']) {
      const t = parseTooltip([line(first), line('REQ LEV: 35'), line('Weapon Attack: +62 (60 +2)')], byGame)!;
      expect(t.key, first).toBe('axe pole arm');
      expect(t.name).toBe('Axe Pole Arm');
    }
    // the recorded Traus tooltip: a junk first line, then the name with a mark in front
    expect(parseTooltip(lines('tooltip-traus.tooltip'), byGame)).toMatchObject({ key: 'traus', name: 'Traus' });
  });

  it('is nothing without a name, or without stats and slots', () => {
    expect(parseTooltip([line('REQ LEV: 40'), line('Weapon Attack: +60')], resolve)).toBeNull();
    expect(parseTooltip([line('Traus'), line('REQ LEV: 40'), line('Attack Speed: Fast')], resolve)).toBeNull();
    expect(parseTooltip([], resolve)).toBeNull();
  });
});

describe('statKind', () => {
  it('knows stat labels through a misread letter or two', () => {
    expect(statKind('Weapon Attack')).toEqual({ label: 'att', weight: 1 });
    expect(statKind('WWeapan Attack')?.label).toBe('att');
    expect(statKind('Wieapon Attack')?.label).toBe('att');
    expect(statKind('Magic Attack')?.label).toBe('magic att');
    expect(statKind('Avoidability')?.label).toBe('avoid');
    expect(statKind('MaxHP')?.label).toBe('HP');
    expect(statKind('LUK')?.label).toBe('LUK');
  });
  it('wants short labels exact, and knows what is not a stat', () => {
    expect(statKind('STP')).toBeNull();
    expect(statKind('Attack Speed')).toBeNull();
    expect(statKind('FER STR')).toBeNull();
    expect(statKind('Type')).toBeNull();
  });
});

describe('statNumbers', () => {
  it('reads total and base', () => {
    expect(statNumbers('+62 (60 +2)')).toEqual({ total: 62, base: 60 });
    expect(statNumbers('+58 (60-2)')).toEqual({ total: 58, base: 60 });
    expect(statNumbers('+60')).toEqual({ total: 60, base: 60 });
  });
  it('checks each part against the others', () => {
    expect(statNumbers('+62 (G0 +2)')).toEqual({ total: 62, base: 60 });   // 6 read as G
    expect(statNumbers('+62 (0 +2)')).toEqual({ total: 62, base: 60 });    // 6 lost
    expect(statNumbers('+58 (ED -2)')).toEqual({ total: 58, base: 60 });   // 60 read as letters
    expect(statNumbers('+62 (50 +2)')).toEqual({ total: 62, base: 60 });   // 6 read as 5
    expect(statNumbers('+58 (60 2)')).toEqual({ total: 58, base: 60 });    // minus lost
    expect(statNumbers('+62 (60 -2)')).toEqual({ total: 62, base: 60 });   // plus read as minus
  });
  it('counts what it cannot make sense of as average', () => {
    expect(statNumbers('+62 (602)')).toEqual({ total: 62, base: 62 });
    expect(statNumbers('+62 (G)')).toEqual({ total: 62, base: 62 });
    expect(statNumbers('Fast')).toBeNull();
  });
});

describe('statValue', () => {
  const tip = (stats: [string, number, number, number][], remaining: number | null, type = 'One-handed Sword') => ({
    key: 'traus', name: 'Traus', type, remaining,
    stats: stats.map(([label, weight, total, base]) => ({ label, weight, total, base, delta: total - base })),
  });
  const opts = { statPct: 8, slotWorth: 1 };

  it('knows the slots each type starts with', () => {
    expect(slotsForType('One-handed Sword')).toBe(7);
    expect(slotsForType('Polearm')).toBe(7);
    expect(slotsForType('Overall')).toBe(10);
    expect(slotsForType('Gloves')).toBe(5);
    expect(slotsForType('Ring')).toBe(0);
  });

  it('is average for clean average stats', () => {
    const v = statValue(tip([['att', 1, 60, 60]], 7), opts);
    expect(v).toMatchObject({ mult: 1, points: 0, used: 0, summary: 'average stats, 7 slots left' });
  });

  it('moves by statPct per point', () => {
    expect(statValue(tip([['att', 1, 62, 60]], 7), opts).mult).toBeCloseTo(1.16);
    expect(statValue(tip([['att', 1, 58, 60]], 7), opts).mult).toBeCloseTo(0.84);
    expect(statValue(tip([['STR', 0.5, 5, 1]], 7), opts).mult).toBeCloseTo(1.16);
  });

  it('charges each used slot', () => {
    const v = statValue(tip([['att', 1, 62, 60]], 5), opts);
    expect(v.used).toBe(2);
    expect(v.mult).toBeCloseTo(1);
    expect(v.summary).toBe('+2 att, 2 of 7 slots used');
  });

  it('trusts the most slots ever seen on the item over its type', () => {
    expect(statValue(tip([['att', 1, 60, 60]], 7, 'Ring'), { ...opts, maxSlotsSeen: 9 }).used).toBe(2);
  });

  describe("with the game data's facts about the item", () => {
    const traus = FACTS.get(1302012)!;
    const read = (stat: string) => parseTooltip([line('Traus'), line('REQ LEV: 40'), line(stat), line('Remaining Enhancements: 7')], resolve)!;

    it('takes the base from the game data, so the tooltip only has to give the total', () => {
      // the base came out as letters and nothing else tells it: the old rules call that average
      const t = read('Weapon Attack: +62 (ED)');
      expect(statValue(t, opts)).toMatchObject({ points: 0, summary: 'average stats, 7 slots left' });
      const v = statValue(t, { ...opts, fact: traus });
      expect(v).toMatchObject({ points: 2, used: 0, summary: '+2 att, 7 slots left' });
      expect(v.mult).toBeCloseTo(1.16);
    });

    it('counts a stat the item has no base for in full', () => {
      expect(statValue(tip([['att', 1, 60, 60], ['STR', 0.5, 3, 3]], 7), { ...opts, fact: traus }).summary).toBe('+3 STR, 7 slots left');
    });

    it('takes the slots from the game data, over the type and the most ever seen', () => {
      const v = statValue(tip([['att', 1, 62, 60]], 5, ''), { ...opts, fact: traus });
      expect(v).toMatchObject({ used: 2, summary: '+2 att, 2 of 7 slots used' });
      expect(statValue(tip([['att', 1, 60, 60]], 7, 'Overall'), { ...opts, maxSlotsSeen: 9, fact: traus }).used).toBe(0);
      // the game data gives no slot count: the type and the most seen still tell
      expect(statValue(tip([['att', 1, 60, 60]], 7, 'Ring'), { ...opts, maxSlotsSeen: 9, fact: { ...traus, slots: null } }).used).toBe(2);
    });

    it("trusts the bracket's base and difference over a total that disagrees with them", () => {
      // "+68 (60 -2)": the game printed 60 − 2, so the total is 58
      expect(statValue(read('Weapon Attack: +68 (60 -2)'), { ...opts, fact: traus }).summary).toBe('−2 att, 7 slots left');
      // a bracket whose base is not the item's was misread itself: the total stands
      expect(statValue(read('Weapon Attack: +62 (0 +2)'), { ...opts, fact: traus }).summary).toBe('+2 att, 7 slots left');
      expect(statValue(read('Weapon Attack: +62 (60 -2)'), { ...opts, fact: traus }).summary).toBe('+2 att, 7 slots left');
    });
  });

  it('stays within a quarter and three times the usual price', () => {
    expect(statValue(tip([['att', 1, 20, 60]], 0), opts).mult).toBe(0.25);
    expect(statValue(tip([['att', 1, 99, 60]], 7), opts).mult).toBe(3);
  });

  it('names a copy by its stats', () => {
    expect(statSig(tip([['att', 1, 62, 60]], 7))).toBe('att:62/60|7');
    expect(statSig(tip([['att', 1, 62, 60]], null))).toBe('att:62/60|');
  });
});
