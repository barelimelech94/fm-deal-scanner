import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareHover } from '../src/appraisal/hover';
import type { OcrLine } from '../src/lib/types';
import { resolveKey } from '../src/market/matching';
import { parseTooltip, statKind, statNumbers } from '../src/tooltip/parseTooltip';
import { tooltipResolver } from '../src/tooltip/resolve';
import { statSig, statValue } from '../src/tooltip/statValue';
import { iconSide, textSpacing } from '../src/vision/tooltipText';
import { FIXTURES, loadPng, scaleBy } from './helpers/image';
import { hoverEngine } from './helpers/hover';
import { pixelsAdapter } from './helpers/pipeline';

const recorded = (name: string): OcrLine[] => JSON.parse(readFileSync(join(FIXTURES, 'ocr', `hover-${name}.lines.json`), 'utf8')) as OcrLine[];
const line = (text: string, confidence = 95): OcrLine => ({ text, confidence });
const e = hoverEngine();
const read = (name: string) => parseTooltip(recorded(name), tooltipResolver(e), { bare: true });

/** What the real reader made of each hovered tooltip (tests/fixtures/ocr), as the parser reads it. */
const WANT: Record<string, { name: string; type: string; remaining: number | null; sig: string }> = {
  'use-scroll-inventory': { name: 'Overall Armor LUK Scroll: Greater', type: '', remaining: null, sig: '|' },
  'trade-scroll': { name: 'Topwear DEF Scroll: Greater', type: '', remaining: null, sig: '|' },
  'equip-pair-inventory': { name: 'Weighted Earrings', type: 'Earrings', remaining: 5, sig: 'magic def:22/22;avoid:1/1|5' },
  'equip-not-worn': { name: 'Yellow Square', type: 'Earrings', remaining: 5, sig: 'magic def:22/22;crit dmg:1/1|5' },
  'equip-extra-points': { name: 'Blue Bamboo Hat', type: 'Hat', remaining: 7, sig: 'INT:3/2;HP:5/5;weapon def:24/24|7' },
  'trade-equip': { name: 'Lemona', type: 'Gloves', remaining: 5, sig: 'INT:1/1;weapon def:3/3;magic def:5/5;crit rate:1/1|5' },
  'bright-equip-pair-right': { name: 'Green Bamboo Hat', type: 'Hat', remaining: 7, sig: 'DEX:2/2;HP:5/5;weapon def:23/24|7' },
  'bright-potion-count': { name: 'Red Potion', type: '', remaining: null, sig: '|' },
  'bright-potion-covered': { name: 'Red Potion', type: '', remaining: null, sig: '|' },
  'bright-etc-covered': { name: 'Leaf', type: '', remaining: null, sig: '|' },
};

describe('reading hovered tooltips', () => {
  for (const [file, w] of Object.entries(WANT)) {
    it(`reads ${w.name} from ${file}`, () => {
      const t = read(file)!;
      expect(t, recorded(file).map((l) => l.text).join('\n')).not.toBeNull();
      expect({ name: t.name, type: t.type, remaining: t.remaining, sig: statSig(t) }).toEqual(w);
    });
  }

  it('reads the item you hover, not the one you wear beside it', () => {
    // the pair's recording is of the left tooltip only: Weighted Earrings, not Red Cross Earrings
    expect(read('equip-pair-inventory')!.name).toBe('Weighted Earrings');
    expect(read('bright-equip-pair-right')!.name).toBe('Green Bamboo Hat');
  });

  it('sees a point above or below base, and prices it', () => {
    const hat = statValue(read('equip-extra-points')!, { statPct: 8, slotWorth: 1 });
    expect(hat).toMatchObject({ points: 0.5, used: 0, summary: '+1 INT, 7 slots left' });
    expect(hat.mult).toBeCloseTo(1.04, 5);
    const green = statValue(read('bright-equip-pair-right')!, { statPct: 8, slotWorth: 1 });
    expect(green.summary).toBe('−1 weapon def, 7 slots left');
    expect(green.mult).toBeCloseTo(1 + (-0.05 * 8) / 100, 5);
  });

  it('is nothing for a scroll or potion unless asked, so the shop reads as before', () => {
    expect(parseTooltip(recorded('use-scroll-inventory'), tooltipResolver(e))).toBeNull();
    expect(parseTooltip(recorded('bright-potion-count'), tooltipResolver(e))).toBeNull();
  });

  it('is nothing for a name no item has, even when asked', () => {
    expect(parseTooltip([line('* Zzyzx Qwerty Thing'), line('Improves nothing at all.')], tooltipResolver(e), { bare: true })).toBeNull();
  });
});

describe('stat lines of the item tooltips', () => {
  it('knows the labels they print', () => {
    expect(statKind('Weapon Def.')?.label).toBe('weapon def');
    expect(statKind('Magic Def.')?.label).toBe('magic def');
    expect(statKind('Weapon Det')?.label).toBe('weapon def');
    expect(statKind('Evasion')?.label).toBe('avoid');
    expect(statKind('Critical Rate')?.label).toBe('crit rate');
    expect(statKind('Critical Damage')?.label).toBe('crit dmg');
    expect(statKind('MaxHP')?.label).toBe('HP');
    expect(statKind('INT')?.label).toBe('INT');
    expect(statKind('Success rate')).toBeNull();
    expect(statKind('Improves Luck on overalls')).toBeNull();
  });

  it('reads a total with its base, a lost minus, and a plus read as another symbol', () => {
    expect(statNumbers('+25 (24 +1)')).toEqual({ total: 25, base: 24 });
    expect(statNumbers('+23 (24 -1)')).toEqual({ total: 23, base: 24 });
    expect(statNumbers('+23 (24 1)')).toEqual({ total: 23, base: 24 });
    expect(statNumbers('+23 (24 - 1)')).toEqual({ total: 23, base: 24 });
    expect(statNumbers('#1')).toEqual({ total: 1, base: 1 });
    expect(statNumbers('+3 (2 +1)')).toEqual({ total: 3, base: 2 });
    expect(statNumbers('+22')).toEqual({ total: 22, base: 22 });
  });

  it('ignores a scroll\'s description lines', () => {
    const t = parseTooltip([
      line('* Overall Armor LUK Scroll: Greater'), line('Improves Luck on overalls.'), line('Success rate: 10%, LUK +3'),
    ], tooltipResolver(e), { bare: true })!;
    expect(t).toMatchObject({ name: 'Overall Armor LUK Scroll: Greater', stats: [], remaining: null });
  });

  it('reads a name whose bullet came out as a letter', () => {
    expect(parseTooltip([line('sLeaf', 14), line('A leaf that\'s taken out of a tree.')], tooltipResolver(e), { bare: true })).toMatchObject({ name: 'Leaf' });
    expect(parseTooltip([line('oWeighted Earrings'), line('Type: Earrings'), line('Remaining Enhancements: 5')], tooltipResolver(e))).toMatchObject({ name: 'Weighted Earrings' });
    // a name that really starts with a lowercase letter and a capital is left alone
    expect(parseTooltip([line('Lemona'), line('Type: Gloves'), line('Remaining Enhancements: 5')], tooltipResolver(e))).toMatchObject({ name: 'Lemona' });
  });

  it('skips a stray line above the name when the name is a real item', () => {
    const t = parseTooltip([line("Am juback's", 36), line('*Lemona', 88), line('REQ LEV: 15'), line('Type: Gloves'), line('+ INT: #1')], tooltipResolver(e))!;
    expect(t).toMatchObject({ name: 'Lemona', type: 'Gloves' });
    expect(t.stats).toEqual([{ label: 'INT', weight: 0.5, total: 1, base: 1, delta: 0 }]);
  });
});

describe('names read through the see-through box', () => {
  it('allows one more misread letter than a shop listing, between no two items', () => {
    const cat = { market: e.market, book: e.book };
    expect(resolveKey(cat, 'chen Bamboo Hat', false)).toBe('chen bamboo hat');
    expect(resolveKey(cat, 'chen Bamboo Hat', false, 1)).toBe('green bamboo hat');
    expect(tooltipResolver(e)('chen Bamboo Hat')).toEqual({ key: 'green bamboo hat', known: 'Green Bamboo Hat' });
    // two items equally close stay unmatched
    expect(tooltipResolver(e)('Bamboo Hat').known).toBeNull();
  });

  it('leaves short names exact, so "Leaf" is never another item', () => {
    expect(tooltipResolver(e)('Leaf').known).toBe('Leaf');
    expect(tooltipResolver(e)('Loaf').known).toBeNull();
  });
});

describe('the picture as a ruler', () => {
  const frame = (name: string, f = 1) => (f === 1 ? loadPng(`appraisal/${name}.png`) : scaleBy(loadPng(`appraisal/${name}.png`), f));
  const crop = (name: string, f: number) => {
    const c = prepareHover(pixelsAdapter, frame(name, f))!;
    return pixelsAdapter.crop(frame(name, f), { sx: c.box.px.x, sy: c.box.px.y, sw: c.box.px.w, sh: c.box.px.h }, 1);
  };

  it('is the same size, in game pixels, in every kind of tooltip', () => {
    for (const n of Object.keys(WANT)) expect(iconSide(crop(n, 1)), n).toBeGreaterThan(90);
    for (const n of Object.keys(WANT)) expect(iconSide(crop(n, 1)), n).toBeLessThan(94);
  });

  it('follows the window size, so the lines are always enlarged to suit the reader', () => {
    for (const n of ['use-scroll-inventory', 'equip-pair-inventory', 'bright-potion-count']) {
      const at1 = textSpacing(crop(n, 1))!;
      expect(at1).toBeGreaterThan(21);
      expect(at1).toBeLessThan(22.5);
      expect(textSpacing(crop(n, 0.5))! / at1).toBeCloseTo(0.5, 1);
      expect(textSpacing(crop(n, 1.5))! / at1).toBeCloseTo(1.5, 1);
    }
  });

  it('is nothing where there is no picture', () => {
    expect(iconSide({ data: new Uint8ClampedArray(60 * 60 * 4), width: 60, height: 60 })).toBeNull();
    expect(textSpacing({ data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 })).toBeNull();
  });
});

describe('prepareHover', () => {
  it('copies the hovered tooltip, enlarged for the reader', () => {
    const c = prepareHover(pixelsAdapter, loadPng('appraisal/use-scroll-inventory.png'))!;
    expect(c.box.px).toMatchObject({ w: expect.any(Number) as number });
    expect(c.sig).toHaveLength(48 * 48);
    expect(Buffer.isBuffer(c.image)).toBe(true);
  });

  it('copies the left one of a pair', () => {
    const left = prepareHover(pixelsAdapter, loadPng('appraisal/equip-pair-inventory.png'))!;
    expect(left.box.px.x).toBeLessThan(200);
    expect(left.box.px.w).toBeLessThan(340);
  });

  it('finds nothing when no tooltip is showing', () => {
    expect(prepareHover(pixelsAdapter, loadPng('appraisal/none-brick-map.png'))).toBeNull();
    expect(prepareHover(pixelsAdapter, loadPng('appraisal/none-inventory-top.png'))).toBeNull();
    expect(prepareHover(pixelsAdapter, loadPng('shop-list.png'))).toBeNull();
  });
});
