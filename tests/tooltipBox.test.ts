import { describe, expect, it } from 'vitest';
import { findTooltipBoxes, hoveredBox, isTipFill, TOOLTIP_BOX_WIDTH } from '../src/vision/tooltipBox';
import { examine, loadPng, scaleBy } from './helpers/image';

/** [x, y, w, h] in the fixture's own pixels, checked by eye against the screenshots. */
const WANT: Record<string, [number, number, number, number][]> = {
  'use-scroll-inventory': [[168, 298, 386, 151]],
  'equip-pair-inventory': [[126, 209, 316, 274], [448, 209, 316, 296]],
  'equip-not-worn': [[158, 219, 319, 273]],
  'equip-extra-points': [[261, 323, 311, 301]],
  'trade-scroll': [[349, 371, 387, 150]],
  'trade-equip': [[261, 371, 317, 354]],
  'bright-equip-pair-right': [[42, 116, 316, 302], [366, 116, 317, 298]],
  'bright-potion-count': [[58, 124, 390, 154]],
  'bright-potion-covered': [[38, 122, 390, 153]],
  'bright-etc-covered': [[96, 229, 390, 153]],
  'none-inventory-top': [],
  'none-brick-map': [],
};
const TOL = 14;
const find = (name: string, f = 1) => findTooltipBoxes(examine(f === 1 ? loadPng(`appraisal/${name}.png`) : scaleBy(loadPng(`appraisal/${name}.png`), f), TOOLTIP_BOX_WIDTH));
const px = (b: { px: { x: number; y: number; w: number; h: number } }) => [b.px.x, b.px.y, b.px.w, b.px.h];

describe('findTooltipBoxes', () => {
  for (const [name, want] of Object.entries(WANT)) {
    it(`${want.length ? `finds ${want.length === 1 ? 'the tooltip' : 'both tooltips'}` : 'finds nothing'} in ${name}`, () => {
      const got = find(name);
      expect(got).toHaveLength(want.length);
      want.forEach((w, i) => px(got[i]!).forEach((v, k) => expect(Math.abs(v - w[k]!), `${name} box ${i} value ${k}`).toBeLessThanOrEqual(TOL)));
    });
  }

  it('reports the box as fractions of the frame as well as pixels', () => {
    const b = find('use-scroll-inventory')[0]!;
    expect(b.x).toBeCloseTo(b.px.x / 820, 2);
    expect(b.w).toBeCloseTo(b.px.w / 820, 2);
    expect(b.h).toBeCloseTo(b.px.h / 630, 2);
  });

  it('finds them left to right', () => {
    for (const name of ['equip-pair-inventory', 'bright-equip-pair-right']) {
      const b = find(name);
      expect(b[0]!.x).toBeLessThan(b[1]!.x);
      expect(b[0]!.x + b[0]!.w).toBeLessThanOrEqual(b[1]!.x + 0.01);
    }
  });

  it('finds the same tooltips when the game window is smaller', () => {
    const half = find('equip-pair-inventory', 0.5);
    expect(half).toHaveLength(2);
    expect(half[0]!.px.w).toBeGreaterThan(130);
    expect(half[0]!.px.w).toBeLessThan(180);
    expect(find('use-scroll-inventory', 0.5)).toHaveLength(1);
  });

  it('is not fooled by a shop list, a plain scene or an empty frame', () => {
    expect(findTooltipBoxes(examine(loadPng('shop-list.png'), TOOLTIP_BOX_WIDTH))).toEqual([]);
    expect(findTooltipBoxes(examine(loadPng('scene-no-shop.png'), TOOLTIP_BOX_WIDTH))).toEqual([]);
    expect(findTooltipBoxes({ px: { data: new Uint8ClampedArray(0), width: 0, height: 0 }, scale: 1, fw: 0, fh: 0 })).toEqual([]);
  });

  it('still finds the stats tooltip of the shop tests', () => {
    expect(findTooltipBoxes(examine(loadPng('tooltip-traus.png'), TOOLTIP_BOX_WIDTH))).toHaveLength(1);
  });
});

describe('isTipFill', () => {
  it('takes the box over bricks, over black and over bright scenery', () => {
    expect(isTipFill(60, 45, 80)).toBe(true);     // violet over orange bricks
    expect(isTipFill(10, 11, 59)).toBe(true);     // over black
    expect(isTipFill(114, 114, 156)).toBe(true);  // over white
  });
  it('leaves out bricks, trees, sky, windows and darkness', () => {
    expect(isTipFill(160, 107, 52)).toBe(false);
    expect(isTipFill(70, 120, 60)).toBe(false);
    expect(isTipFill(150, 200, 240)).toBe(false);
    expect(isTipFill(206, 219, 228)).toBe(false);
    expect(isTipFill(0, 0, 17)).toBe(false);
    expect(isTipFill(80, 80, 80)).toBe(false);
  });
});

describe('hoveredBox', () => {
  const box = (x: number, y = 0.2, w = 0.3, h = 0.3) => ({ x, y, w, h });
  it('is the left one of a pair', () => {
    expect(hoveredBox([box(0.2), box(0.52)])).toEqual(box(0.2));
    expect(hoveredBox([box(0.52), box(0.2)])).toEqual(box(0.2));
  });
  it('is the only one when there is one, and nothing when there is none', () => {
    expect(hoveredBox([box(0.4)])).toEqual(box(0.4));
    expect(hoveredBox([])).toBeNull();
  });
  it('is the larger of two that are not a pair', () => {
    const far = box(0.8, 0.7, 0.1, 0.1), big = box(0.1);
    expect(hoveredBox([far, big])).toEqual(big);
    expect(hoveredBox([big, far])).toEqual(big);
  });
});
