// Accuracy benchmark: screenshots at many game and screen sizes go through the whole scanner (find,
// crop, prepare, read, parse, match) with the real text reader. Run with `npm run bench`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawListing } from '../../src/lib/types';
import { prepareHover, readHover } from '../../src/appraisal/hover';
import { Scanner, type Ocr } from '../../src/scan/scanner';
import { ShopSession } from '../../src/shop/session';
import { tooltipResolver } from '../../src/tooltip/resolve';
import { statSig } from '../../src/tooltip/statValue';
import type { Pixels } from '../../src/vision/pixels';
import { loadPng, placeOn, scaleBy } from '../helpers/image';
import { hoverEngine } from '../helpers/hover';
import { CATALOG, engine } from '../helpers/market';
import { nodeOcr, pixelsAdapter } from '../helpers/pipeline';

let ocr: Ocr<Buffer> & { terminate(): Promise<void> };
beforeAll(async () => { ocr = await nodeOcr(); });
afterAll(async () => { await ocr.terminate(); });

const STILL = { auto: true, region: null, readStats: true, live: false, force: true } as const;

/** With tracker data, or with none: names then come from the game's own item list. */
function scanner(tracker = true) {
  const e = engine(tracker ? {} : { items: [] });
  e.market = e.market.withCatalog(CATALOG);
  const session = new ShopSession(e);
  return { e, session, scanner: new Scanner(pixelsAdapter, ocr, session, e) };
}

const rowsOf = (s: ShopSession) => [...s.rows.values()].map((r) => `${r.key}|${r.qty}|${r.price}×${r.count}`).sort();

const SHOPS = {
  'shop-list.png': [
    'bronze chain boots|1|16999×1', 'bronze chain boots|1|9999×1', 'cape int scroll lesser|1|99999×1',
    'dark guardian|1|79999×1', 'lemona|1|19999×1', 'shoes speed scroll chaos|1|29999×1',
  ],
  // five identical listings, the first one selected (orange)
  'shop-selected-row.png': ['wolbi throwing stars|500|2999×5'],
};

/** Game sizes (relative to the Retina fixtures) and the screens they're on. */
const SIZES: [number, number, number][] = [
  [0.4, 1280, 800], [0.45, 1280, 800], [0.5, 1440, 900], [0.55, 1440, 900], [0.6, 1512, 982], [0.7, 1920, 1080],
  [0.8, 1920, 1200], [0.9, 2560, 1440], [1.0, 3024, 1964], [1.25, 3024, 1964], [1.5, 3456, 2234],
];

/** Listings as a multiset: "key|qty|price" once per copy. */
const listings = (s: ShopSession) => [...s.rows.values()].flatMap((r) => Array<string>(r.count).fill(`${r.key}|${r.qty}|${r.price}`));
const expand = (want: string[]) => want.flatMap((w) => { const [k, n] = w.split('×'); return Array<string>(+n!).fill(k!); });

/**
 * The reader is not perfect, so this is a benchmark with a bar, not an exact test: of all listings
 * on all frames, at least 97% must read exactly, and at most 2% may read as something else (a
 * wrong price is worse than a missed listing: it can look like a deal). Misses are printed.
 */
const MIN_READ = 0.97, MAX_WRONG = 0.02;

describe('reading shops', () => {
  it(`reads at least ${MIN_READ * 100}% of listings at every size, with at most ${MAX_WRONG * 100}% wrong`, async () => {
    let total = 0, read = 0, wrong = 0;
    const report: string[] = [];
    for (const [file, want] of Object.entries(SHOPS)) {
      for (const [f, sw, sh] of SIZES) {
        const frame = placeOn(scaleBy(loadPng(file), f), sw, sh, Math.round(sw * 0.3), Math.round(sh * 0.2));
        const { session, scanner: sc } = scanner();
        await sc.scan(frame, STILL);
        const left = expand(want), got = listings(session);
        let hit = 0;
        const extra: string[] = [];
        for (const g of got) { const i = left.indexOf(g); if (i >= 0) { left.splice(i, 1); hit++; } else extra.push(g); }
        total += hit + left.length; read += hit; wrong += extra.length;
        if (left.length || extra.length) {
          report.push(`${file} at ${f}: missed ${JSON.stringify(left)}, wrong ${JSON.stringify(extra)}\n    ${sc.lastLines.join('\n    ')}`);
        }
      }
    }
    console.log(`read ${read}/${total} (${((100 * read) / total).toFixed(1)}%), wrong ${wrong}${report.length ? '\n' + report.join('\n') : ''}`);
    expect(read / total).toBeGreaterThanOrEqual(MIN_READ);
    expect(wrong / total).toBeLessThanOrEqual(MAX_WRONG);
  });

  it('finds nothing to read in a scene without a shop', async () => {
    const { session, scanner: sc } = scanner();
    await sc.scan(placeOn(scaleBy(loadPng('scene-no-shop.png'), 2), 1920, 1200, 400, 200), STILL);
    expect(sc.found).toBeNull();
    expect(session.rows.size).toBe(0);
    expect(sc.lastTipLines).toBeNull();
  });
});

/** The tooltip drawn over the shop list where the mouse is, as in a real hover. */
function hover(tipFile: string, f: number, sw: number, sh: number): { frame: Pixels; at: { x: number; y: number } } {
  const tip = scaleBy(loadPng(tipFile), f);
  const frame = placeOn(scaleBy(loadPng('shop-list.png'), f), sw, sh, 100, 100);
  const at = { x: Math.round(100 + 300 * f), y: Math.round(100 + 120 * f) };
  for (let y = 0; y < tip.height && at.y + y < sh; y++) for (let x = 0; x < tip.width && at.x + x < sw; x++) {
    const s = (y * tip.width + x) * 4, o = ((at.y + y) * sw + at.x + x) * 4;
    frame.data[o] = tip.data[s]!; frame.data[o + 1] = tip.data[s + 1]!; frame.data[o + 2] = tip.data[s + 2]!;
  }
  return { frame, at };
}

const raw = (name: string, price: number, fy: number): RawListing => ({ name, truncated: false, nameConf: 95, cy: null, qty: 1, price, greyed: false, unsure: false, fy });

describe('reading stats from tooltips', () => {
  const TIPS = [
    { file: 'tooltip-traus.png', name: 'Traus', sig: 'att:58/60|7', summary: '−2 att' },
    { file: 'tooltip-axe-pole-arm.png', name: 'Axe Pole Arm', sig: 'att:62/60|7', summary: '+2 att' },
  ];
  // the game sizes the tooltip can be found at (see the vision tests): a game pixel of 1 screen
  // pixel, or 1.2 and up
  const TIP_SIZES = SIZES.filter(([f]) => f === 0.5 || f >= 0.6);
  for (const t of TIPS) for (const tracker of [true, false]) {
    for (const [f, sw, sh] of TIP_SIZES) {
      it(`reads ${t.name}'s stats at ${Math.round(f * 100)}% ${tracker ? 'with' : 'without'} tracker data and puts them on the listing under the mouse`, async () => {
        const { frame, at } = hover(t.file, f, sw, sh);
        const { session, scanner: sc } = scanner(tracker);
        // the shop as read before the mouse moved over it: two listings of the item, one under the mouse
        session.read([
          ...SHOPS['shop-list.png'].map((k, i) => raw(k.split('|')[0]!, Number(k.split('|')[2]!.split('×')[0]), 0.1 + i * 0.01)),
          raw(t.name, 10000, at.y / sh), raw(t.name, 12000, 0.95),
        ], false);
        await sc.scan(frame, STILL);
        const rows = session.displayRows().filter((r) => r.name === t.name);
        expect(rows.find((r) => r.price === 10000)?.sig, sc.lastTipLines?.join('\n')).toBe(t.sig);
        expect(rows.find((r) => r.price === 12000)?.sig).toBeUndefined();
        expect(session.hover?.summary).toContain(t.summary);
        // the shop stays open under the tooltip
        expect(session.open).toBe(true);
      });
    }
  }
});

/** [item, what its tooltip says as a stat signature]: the screenshots of the Use, Equip and Etc tabs and the trade window. */
const HOVERS: Record<string, [string, string]> = {
  'use-scroll-inventory': ['Overall Armor LUK Scroll: Greater', '|'],
  'trade-scroll': ['Topwear DEF Scroll: Greater', '|'],
  'equip-pair-inventory': ['Weighted Earrings', 'magic def:22/22;avoid:1/1|5'],
  'equip-not-worn': ['Yellow Square', 'magic def:22/22;crit dmg:1/1|5'],
  'equip-extra-points': ['Blue Bamboo Hat', 'INT:3/2;HP:5/5;weapon def:24/24|7'],
  'trade-equip': ['Lemona', 'INT:1/1;weapon def:3/3;magic def:5/5;crit rate:1/1|5'],
  'bright-equip-pair-right': ['Green Bamboo Hat', 'DEX:2/2;HP:5/5;weapon def:23/24|7'],
  'bright-potion-count': ['Red Potion', '|'],
  'bright-potion-covered': ['Red Potion', '|'],
  'bright-etc-covered': ['Leaf', '|'],
};

/**
 * Hovered tooltips at the game sizes where the text is legible (a game pixel of one screen pixel or more).
 * A tooltip read as another item would price the wrong thing, so that is held to a stricter bar than a
 * stat misread, which only nudges the price.
 */
describe('reading hovered tooltips', () => {
  it('reads the item right at every size, and its stats at most sizes, never as another item', async () => {
    const e = hoverEngine();
    let total = 0, named = 0, exact = 0, other = 0;
    const report: string[] = [];
    for (const [file, [name, sig]] of Object.entries(HOVERS)) {
      for (const f of [0.75, 1, 1.25, 1.5]) {
        const frame = f === 1 ? loadPng(`appraisal/${file}.png`) : scaleBy(loadPng(`appraisal/${file}.png`), f);
        const crop = prepareHover(pixelsAdapter, frame);
        total++;
        if (!crop) { report.push(`${file} at ${f}: no tooltip found`); continue; }
        const { tip, lines } = await readHover(ocr, crop, tooltipResolver(e));
        if (tip?.name === name) { named++; if (statSig(tip) === sig) exact++; else report.push(`${file} at ${f}: stats ${statSig(tip)}, wanted ${sig}`); }
        else { if (tip) other++; report.push(`${file} at ${f}: read ${tip ? tip.name : 'nothing'}\n    ${lines.join('\n    ')}`); }
      }
    }
    console.log(`tooltips: ${named}/${total} named right, ${exact}/${total} with stats right, ${other} as another item${report.length ? '\n' + report.join('\n') : ''}`);
    expect(named / total).toBeGreaterThanOrEqual(0.97);
    expect(exact / total).toBeGreaterThanOrEqual(0.8);
    expect(other / total).toBeLessThanOrEqual(0.02);
  });

  it('finds nothing to read where no tooltip shows', () => {
    for (const file of ['none-brick-map', 'none-inventory-top']) expect(prepareHover(pixelsAdapter, loadPng(`appraisal/${file}.png`))).toBeNull();
  });
});
