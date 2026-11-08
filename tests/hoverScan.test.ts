import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appraise } from '../src/appraisal/appraise';
import { addEntry, entryFor } from '../src/appraisal/entries';
import { HoverCollector, hasStats } from '../src/appraisal/hovers';
import { AREA_MARGIN, HoverScanner, nearArea } from '../src/appraisal/hoverScan';
import type { AppraisalData, OcrLine, TooltipRead } from '../src/lib/types';
import type { Ocr } from '../src/scan/scanner';
import { FIXTURES, loadPng } from './helpers/image';
import { hoverEngine } from './helpers/hover';
import { pixelsAdapter } from './helpers/pipeline';

const recorded = (name: string): OcrLine[] => JSON.parse(readFileSync(join(FIXTURES, 'ocr', `hover-${name}.lines.json`), 'utf8')) as OcrLine[];

/** The reader, replaced by what it read from each fixture before (see scripts/record-hover.ts). */
function setup(lines: () => OcrLine[]) {
  const e = hoverEngine(), data: AppraisalData = { entries: [] }, collector = new HoverCollector(e, data);
  let reads = 0;
  const ocr: Ocr<Buffer> = { recognize: async () => { reads++; return lines(); } };
  return { e, data, collector, scanner: new HoverScanner(pixelsAdapter, ocr, collector, e), reads: () => reads };
}
const names = (d: AppraisalData) => d.entries.map((x) => `${x.name}×${x.qty}`);

describe('HoverScanner', () => {
  it('adds the hovered item to the appraisal, from a screenshot, at once', async () => {
    const { scanner, data } = setup(() => recorded('use-scroll-inventory'));
    const ev = await scanner.scan(loadPng('appraisal/use-scroll-inventory.png'), { live: false, area: null });
    expect(ev).toMatchObject({ kind: 'added', warn: true });
    expect(ev!.text).toContain('type how many you have');
    expect(names(data)).toEqual(['Overall Armor LUK Scroll: Greater×1']);
    expect(data.entries[0]!.unsure).toBe(true);   // a stack: how many is for the person to type
  });

  it('adds an equip with its stats, as one item', async () => {
    const { scanner, data } = setup(() => recorded('equip-extra-points'));
    const ev = await scanner.scan(loadPng('appraisal/equip-extra-points.png'), { live: false, area: null });
    expect(ev).toMatchObject({ kind: 'added', text: 'Added Blue Bamboo Hat', warn: false });
    expect(data.entries[0]).toMatchObject({ name: 'Blue Bamboo Hat', qty: 1 });
    expect(data.entries[0]!.tip?.stats.map((s) => `${s.label}:${s.total}/${s.base}`)).toEqual(['INT:3/2', 'HP:5/5', 'weapon def:24/24']);
    expect(data.entries[0]!.unsure).toBeUndefined();
  });

  it('prices what it added', async () => {
    const { scanner, data, e } = setup(() => recorded('equip-extra-points'));
    await scanner.scan(loadPng('appraisal/equip-extra-points.png'), { live: false, area: null });
    expect(appraise(e, data.entries, 'fair').lines[0]).toMatchObject({ unit: 2080, total: 2080, tag: 'priced' });   // 2,000 × 1.04
  });

  it('reads the left tooltip of a pair, the one hovered', async () => {
    const { scanner, data } = setup(() => recorded('equip-pair-inventory'));
    await scanner.scan(loadPng('appraisal/equip-pair-inventory.png'), { live: false, area: null });
    expect(names(data)).toEqual(['Weighted Earrings×1']);
  });

  it('counts the same slot once, however often it is read', async () => {
    const { scanner, data, reads } = setup(() => recorded('use-scroll-inventory'));
    const frame = loadPng('appraisal/use-scroll-inventory.png');
    await scanner.scan(frame, { live: false, area: null });
    // the tooltip is the same: not read again
    expect(await scanner.scan(frame, { live: false, area: null })).toBeNull();
    expect(reads()).toBe(1);
    // gone and back: read again, but the slot is the same
    await expect(scanner.scan(loadPng('appraisal/none-brick-map.png'), { live: false, area: null })).resolves.toBeNull();
    const ev = await scanner.scan(frame, { live: false, area: null });
    expect(ev).toMatchObject({ kind: 'again' });
    expect(names(data)).toEqual(['Overall Armor LUK Scroll: Greater×1']);
    expect(reads()).toBe(2);
  });

  it('needs a live tooltip to stay for two checks, so passing over items counts none', async () => {
    const { scanner, data, reads } = setup(() => recorded('bright-potion-count'));
    const hover = loadPng('appraisal/bright-potion-count.png'), other = loadPng('appraisal/bright-potion-covered.png');
    expect(await scanner.scan(hover, { live: true, area: null })).toBeNull();   // seen once
    expect(await scanner.scan(other, { live: true, area: null })).toBeNull();   // moved on: seen once again
    expect(await scanner.scan(other, { live: true, area: null })).toMatchObject({ kind: 'added' });   // stayed
    expect(reads()).toBe(1);
    expect(names(data)).toEqual(['Red Potion×1']);
  });

  it('says so when it cannot tell which item a tooltip is for', async () => {
    const { scanner, data } = setup(() => [{ text: '* Zzyzx Qwerty Thing', confidence: 80 }, { text: 'Does nothing at all.', confidence: 80 }]);
    const ev = await scanner.scan(loadPng('appraisal/use-scroll-inventory.png'), { live: false, area: null });
    expect(ev).toMatchObject({ kind: 'unreadable', warn: true });
    expect(ev!.text).toContain('Does nothing');
    expect(data.entries).toEqual([]);
  });

  it('finds nothing to do where no tooltip shows', async () => {
    const { scanner, reads } = setup(() => []);
    expect(await scanner.scan(loadPng('appraisal/none-inventory-top.png'), { live: false, area: null })).toBeNull();
    expect(reads()).toBe(0);
  });

  describe('with an area marked', () => {
    const frame = loadPng('appraisal/use-scroll-inventory.png');   // 820 × 630: the tooltip is at 21-68% across, 47-71% down
    it('counts a tooltip beside the area', async () => {
      const { scanner, data } = setup(() => recorded('use-scroll-inventory'));
      await scanner.scan(frame, { live: false, area: { x: 0.05, y: 0.05, w: 0.3, h: 0.45 } });
      expect(data.entries).toHaveLength(1);
    });
    it('ignores a tooltip far from it, and does not read it', async () => {
      const { scanner, data, reads } = setup(() => recorded('use-scroll-inventory'));
      expect(await scanner.scan(frame, { live: false, area: { x: 0.8, y: 0.0, w: 0.15, h: 0.15 } })).toBeNull();
      expect(data.entries).toEqual([]);
      expect(reads()).toBe(0);
    });
  });
});

describe('nearArea', () => {
  const area = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  it('takes boxes that touch the area or sit just beside it', () => {
    expect(nearArea({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, area)).toBe(true);
    expect(nearArea({ x: 0.6 + AREA_MARGIN / 2, y: 0.5, w: 0.1, h: 0.1 }, area)).toBe(true);
    expect(nearArea({ x: 0.1, y: 0.1, w: 0.3 + AREA_MARGIN / 2, h: 0.3 + AREA_MARGIN / 2 }, area)).toBe(true);
  });
  it('leaves out boxes further away', () => {
    expect(nearArea({ x: 0.7, y: 0.5, w: 0.1, h: 0.1 }, area)).toBe(false);
    expect(nearArea({ x: 0.5, y: 0.7, w: 0.1, h: 0.1 }, area)).toBe(false);
    expect(nearArea({ x: 0.0, y: 0.0, w: 0.2, h: 0.2 }, area)).toBe(false);
  });
});

describe('HoverCollector', () => {
  const e = hoverEngine();
  const tip = (name: string, stats = false): TooltipRead => ({ key: name.toLowerCase(), name, type: stats ? 'Hat' : '', remaining: stats ? 7 : null, stats: stats ? [{ label: 'INT', weight: 0.5, total: 3, base: 2, delta: 1 }] : [] });
  const at = (x: number, y = 100) => ({ x, y, pitch: 48 });
  const make = () => { const data: AppraisalData = { entries: [] }; return { data, c: new HoverCollector(e, data) }; };

  it('knows an equip from a stack by its tooltip', () => {
    expect(hasStats(tip('Lemona', true))).toBe(true);
    expect(hasStats(tip('Red Potion'))).toBe(false);
    expect(hasStats({ ...tip('Lemona'), remaining: 5 })).toBe(true);
  });

  it('adds one line per item, and one more of it for each other slot', () => {
    const { data, c } = make();
    c.ingest(tip('Lemona', true), at(100));
    c.ingest(tip('Lemona', true), at(400));   // another copy, same stats
    c.ingest(tip('Lemona', true), at(104));   // the first slot again
    expect(names(data)).toEqual(['Lemona×2']);
  });

  it('keeps copies with other stats on their own line', () => {
    const { data, c } = make();
    c.ingest(tip('Blue Bamboo Hat', true), at(100));
    c.ingest({ ...tip('Blue Bamboo Hat', true), stats: [{ label: 'INT', weight: 0.5, total: 2, base: 2, delta: 0 }] }, at(400));
    expect(names(data)).toEqual(['Blue Bamboo Hat×1', 'Blue Bamboo Hat×1']);
  });

  it('takes the stack size when it is read, and fixes it when it is read later', () => {
    const { data, c } = make();
    expect(c.ingest(tip('Red Potion'), at(100), 84)).toMatchObject({ kind: 'added', text: 'Added Red Potion ×84', warn: false });
    expect(data.entries[0]).toMatchObject({ qty: 84 });
    expect(data.entries[0]!.unsure).toBeUndefined();
    // the same slot, count hidden before and read now
    const hidden = c.ingest(tip('Leaf'), at(300));
    expect(hidden).toMatchObject({ kind: 'added', warn: true });
    expect(data.entries[1]).toMatchObject({ qty: 1, unsure: true });
    expect(c.ingest(tip('Leaf'), at(305), 12)).toMatchObject({ kind: 'fixed', text: 'Leaf: count is 12' });
    expect(data.entries[1]).toMatchObject({ qty: 12 });
    expect(data.entries[1]!.unsure).toBeUndefined();
  });

  it('adds another stack of the same item to its line', () => {
    const { data, c } = make();
    c.ingest(tip('Red Potion'), at(100), 84);
    c.ingest(tip('Red Potion'), at(400), 16);
    expect(names(data)).toEqual(['Red Potion×100']);
  });

  it('counts a slot afresh when its line was removed', () => {
    const { data, c } = make();
    c.ingest(tip('Lemona', true), at(100));
    data.entries = [];
    expect(c.ingest(tip('Lemona', true), at(100))).toMatchObject({ kind: 'added' });
    expect(names(data)).toEqual(['Lemona×1']);
  });

  it('takes back the last item, and one at a time', () => {
    const { data, c } = make();
    expect(c.undo()).toBeNull();
    expect(c.canUndo).toBe(false);
    c.ingest(tip('Red Potion'), at(100), 84);
    c.ingest(tip('Red Potion'), at(400), 16);
    c.ingest(tip('Lemona', true), at(700));
    expect(c.canUndo).toBe(true);
    expect(c.undo()).toMatchObject({ kind: 'undone', text: 'Took back Lemona' });
    expect(names(data)).toEqual(['Red Potion×100']);
    c.undo();
    expect(names(data)).toEqual(['Red Potion×84']);
    c.undo();
    expect(data.entries).toEqual([]);
    expect(c.canUndo).toBe(false);
  });

  it('does not take back a line a person made by hand', () => {
    const { data, c } = make();
    addEntry(data.entries, entryFor(e, 'Red Potion', 10));
    c.ingest(tip('Red Potion'), at(100), 5);
    expect(names(data)).toEqual(['Red Potion×15']);
    c.undo();
    expect(names(data)).toEqual(['Red Potion×10']);
  });

  it('forgets the slots when the appraisal is cleared', () => {
    const { data, c } = make();
    c.ingest(tip('Lemona', true), at(100));
    data.entries = [];
    c.forget();
    expect(c.canUndo).toBe(false);
    expect(c.last).toBeNull();
  });

  it('reads a tooltip once it has stayed for two checks, and not the same one twice', () => {
    const { c } = make();
    const a = new Float32Array(48 * 48).fill(10), far = new Float32Array(48 * 48).fill(200);
    expect(c.due(a, true)).toBe(false);
    expect(c.due(a, true)).toBe(true);
    expect(c.due(a, true)).toBe(false);   // already read
    c.noTooltip();
    expect(c.due(a, true)).toBe(false);   // it came back: wait again
    expect(c.due(far, true)).toBe(false);
    expect(c.due(far, true)).toBe(true);
    expect(c.due(new Float32Array(48 * 48).fill(5), false)).toBe(true);   // a screenshot: at once
  });
});
