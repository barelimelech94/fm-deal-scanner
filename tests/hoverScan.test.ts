import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appraise, needsCount } from '../src/appraisal/appraise';
import { addEntry, entryFor } from '../src/appraisal/entries';
import { HoverCollector } from '../src/appraisal/hovers';
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

  it('knows an equip from a stack by its id, whatever its tooltip shows', () => {
    const { data, c } = make();
    c.ingest(tip('Lemona'), at(100), 5);              // an equip whose stat lines were not read
    c.ingest(tip('Red Potion', true), at(400), 84);   // a stack with a line misread as a stat
    expect(data.entries.map((x) => ({ name: x.name, qty: x.qty, tip: !!x.tip }))).toEqual([
      { name: 'Lemona', qty: 1, tip: true }, { name: 'Red Potion', qty: 84, tip: false },
    ]);
  });

  it('goes by the tooltip for an item whose id is not known', () => {
    const { data, c } = make();
    c.ingest(tip('Zzyzx Hat', true), at(100), 5);
    c.ingest(tip('Zzyzx Stone'), at(400), 12);
    expect(data.entries.map((x) => ({ name: x.name, qty: x.qty, tip: !!x.tip }))).toEqual([
      { name: 'Zzyzx Hat', qty: 1, tip: true }, { name: 'Zzyzx Stone', qty: 12, tip: false },
    ]);
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

  it('takes a count read off the slot as known, a 1 too, so its line does not ask for one', () => {
    const { data, c } = make();
    const asks = () => appraise(e, data.entries, 'fair').lines.map((l) => `${l.name}:${needsCount(l)}`);
    c.ingest(tip('Red Potion'), at(100), 1);
    c.ingest(tip('Leaf'), at(400));             // its number not read: asked for
    c.ingest(tip('Lemona', true), at(700), 1);  // an equip: one item, nothing to ask
    expect(asks()).toEqual(['Red Potion:false', 'Leaf:true', 'Lemona:false']);
    expect(data.entries.map((x) => !!x.counted)).toEqual([true, false, false]);
    c.ingest(tip('Leaf'), at(404), 1);          // the same slot, its number read now
    expect(asks()).toEqual(['Red Potion:false', 'Leaf:false', 'Lemona:false']);
  });

  it('asks for the count again when the hover that read it is taken back', () => {
    const { data, c } = make();
    addEntry(data.entries, entryFor(e, 'Red Potion'));   // typed in at 1: asked for
    c.ingest(tip('Red Potion'), at(100), 1);              // another stack of 1, read: 2 in all, known
    expect(data.entries[0]).toMatchObject({ qty: 2, counted: true });
    c.undo();
    expect(data.entries[0]!.qty).toBe(1);
    expect(data.entries[0]!.counted).toBeUndefined();
  });

  it('knows the line hovered last, and falls back to the one before when that line goes', () => {
    const { data, c } = make();
    expect(c.lastId).toBeNull();
    const leaf = c.ingest(tip('Leaf'), at(100)).entryId!;
    const lemona = c.ingest(tip('Lemona', true), at(400)).entryId!;
    expect(c.lastId).toBe(lemona);
    // Undo takes Lemona's line away: Leaf was hovered before it
    c.undo();
    expect(c.lastId).toBe(leaf);
    // another stack of Leaf joins its line: still that line
    const hat = c.ingest(tip('Blue Bamboo Hat', true), at(700)).entryId!;
    expect(c.lastId).toBe(hat);
    expect(c.ingest(tip('Leaf'), at(1000), 3).entryId).toBe(leaf);
    expect(c.lastId).toBe(leaf);
    // Undo takes that stack back, and the line stays: still the one hovered last
    c.undo();
    expect(data.entries.find((x) => x.id === leaf)!.qty).toBe(1);
    expect(c.lastId).toBe(leaf);
    // a line removed by hand: the one hovered before it
    data.entries = data.entries.filter((x) => x.id !== leaf);
    expect(c.lastId).toBe(hat);
    // cleared: none
    data.entries = [];
    c.forget();
    expect(c.lastId).toBeNull();
  });

  it('names the line a hover added, counted again or fixed', () => {
    const { data, c } = make();
    const added = c.ingest(tip('Leaf'), at(100));
    const lemona = c.ingest(tip('Lemona', true), at(400));
    const leaf = data.entries[0]!.id;
    expect(added).toMatchObject({ kind: 'added', entryId: leaf });
    expect(lemona).toMatchObject({ kind: 'added', entryId: data.entries[1]!.id });
    expect(c.ingest(tip('Leaf'), at(104))).toMatchObject({ kind: 'again', entryId: leaf });
    expect(c.ingest(tip('Leaf'), at(104), 12)).toMatchObject({ kind: 'fixed', entryId: leaf });
    expect(c.ingest(tip('Leaf'), at(700), 3)).toMatchObject({ kind: 'added', entryId: leaf });   // another stack, the same line
    expect(c.unreadable(['', 'x']).entryId).toBeUndefined();
    expect(c.undo()!.entryId).toBeUndefined();
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

  it('raises its version on every change, and not for checks that change nothing', () => {
    const { c } = make();
    let v = c.version;
    const rose = () => { const up = c.version > v; v = c.version; return up; };
    c.scanning = true;
    expect(rose()).toBe(true);
    c.scanning = true;
    expect(rose()).toBe(false);
    const sig = new Float32Array(48 * 48).fill(1);
    c.due(sig, true); c.noTooltip();
    expect(rose()).toBe(false);
    const ev = c.ingest(tip('Lemona', true), at(100));
    expect(rose()).toBe(true);
    c.ingest(tip('Lemona', true), at(100));   // again: says so
    expect(rose()).toBe(true);
    c.confirm(ev.entryId!);
    expect(rose()).toBe(true);
    c.undo();
    expect(rose()).toBe(true);
    c.unreadable([]);
    expect(rose()).toBe(true);
    c.forget();
    expect(rose()).toBe(true);
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
