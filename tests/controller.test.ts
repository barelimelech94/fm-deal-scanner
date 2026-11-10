import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HoverCollector } from '../src/appraisal/hovers';
import { HoverScanner } from '../src/appraisal/hoverScan';
import { CaptureFailed } from '../src/capture/screen';
import type { AppraisalData, OcrLine, Region } from '../src/lib/types';
import { ScanController, type CaptureSource, type ScanChange } from '../src/scan/controller';
import { Scanner } from '../src/scan/scanner';
import { ShopSession } from '../src/shop/session';
import type { Pixels } from '../src/vision/pixels';
import { HOVER_ITEMS } from './helpers/hover';
import { FIXTURES, loadPng } from './helpers/image';
import { engine, ITEMS } from './helpers/market';
import { pixelsAdapter } from './helpers/pipeline';

const recorded = (name: string): OcrLine[] => JSON.parse(readFileSync(join(FIXTURES, 'ocr', `${name}.lines.json`), 'utf8')) as OcrLine[];
const SHOP_LINES = recorded('shop-list.list'), SCROLL_LINES = recorded('hover-use-scroll-inventory');
const SHOP = loadPng('shop-list.png'), SCROLL = loadPng('appraisal/use-scroll-inventory.png');

/** A screen share that always shows `frame`, or fails to start with `fail`. */
class FakeCapture implements CaptureSource<Pixels> {
  active = false;
  frame: Pixels = SHOP;
  fail: CaptureFailed | null = null;
  async start(): Promise<void> { if (this.fail) throw this.fail; this.active = true; }
  stop(): void { this.active = false; }
  async grab() { return this.active ? { frame: this.frame, done: () => {} } : null; }
  grabSoon() { return this.grab(); }
  sharingWholeScreen(): boolean { return false; }
}

/**
 * The controller with the real scanners, a fake share and a reader that answers what it read before from the
 * fixtures: the shop list for a shop, the scroll's tooltip for anything else. It counts the passes.
 */
function setup(o: { region?: Region | null } = {}) {
  const e = engine({ items: [...ITEMS, ...HOVER_ITEMS.filter((it) => !ITEMS.some((x) => x.n === it.n))] });
  const data: AppraisalData = { entries: [] };
  const session = new ShopSession(e), collector = new HoverCollector(e, data);
  const reads: string[] = [];
  let lines: OcrLine[] = SHOP_LINES;
  const reader = {
    ready: true,
    async load() {},
    async recognize(img: Buffer) { reads.push(String(img.length)); return lines; },
  };
  const capture = new FakeCapture();
  const ticker = { ms: 0, started: 0, stopped: 0 };
  const c = new ScanController<Pixels, Buffer>({
    engine: e, capture, reader, session, collector,
    repeat: () => ({ start: (ms) => { ticker.ms = ms; ticker.started++; }, stop: () => { ticker.stopped++; } }),
    shop: new Scanner(pixelsAdapter, reader, session, e),
    hovers: new HoverScanner(pixelsAdapter, reader, collector, e),
    shopRegion: () => o.region ?? null,
    itemsArea: () => null,
  });
  const changes: ScanChange['kind'][] = [];
  c.on((x) => changes.push(x.kind));
  return {
    e, c, data, session, collector, capture, ticker, changes,
    reads: () => reads.length,
    answer: (l: OcrLine[]) => { lines = l; },
  };
}

describe('ScanController', () => {
  describe('deals mode', () => {
    it('reads the shop list into the open shop', async () => {
      const { c, session, reads } = setup();
      expect(c.mode).toBe('deals');
      await c.useStill(SHOP);
      expect(session.open).toBe(true);
      expect(session.listingCount()).toBe(6);
      expect(reads()).toBe(1);
      expect(c.status()).toMatchObject({ state: 'shop' });
      expect(c.status().html).toContain('6 listings');
    });

    it('never adds a hovered item to your items, even with the scan flag left on', async () => {
      const { c, data, collector, reads, answer } = setup();
      answer(SCROLL_LINES);
      collector.scanning = true;   // as if left on: deals mode doesn't look at it
      const v = collector.version;
      await c.useStill(SCROLL);
      await c.tick(true);
      expect(data.entries).toEqual([]);
      expect(collector.version).toBe(v);
      // the tooltip was read once, by the shop's reader (a scroll has no stats for it)
      expect(reads()).toBe(1);
    });

    it('says when no shop was found', async () => {
      const { c } = setup();
      await c.useStill(SCROLL);
      expect(c.status().html).toContain('no shop window found');
    });

    it('waits for the shop area to be marked when it is not found by itself', async () => {
      const { c, e, reads } = setup();
      e.settings.area = 'manual';
      expect(await c.useStill(SHOP)).toBe(false);
      expect(c.needsShopArea).toBe(true);
      expect(reads()).toBe(0);
      expect(c.status().html).toContain('Mark the shop area');
    });
  });

  describe('inventory mode', () => {
    it('reads the hovered tooltip into your items, in one pass, and only while scanning', async () => {
      const { c, data, reads, answer } = setup();
      answer(SCROLL_LINES);
      c.setMode('inventory');
      await c.useStill(SCROLL);
      expect(reads()).toBe(0);   // not scanning: nothing read
      expect(c.setScanning(true)).toBe(true);
      await c.tick();
      expect(data.entries.map((x) => x.name)).toEqual(['Overall Armor LUK Scroll: Greater']);
      expect(reads()).toBe(1);
      // the same tooltip still there: not read again
      await c.tick();
      await c.tick(true);
      expect(reads()).toBe(1);
    });

    it('never looks for a shop', async () => {
      const { c, session, reads } = setup();
      c.setMode('inventory');
      c.setScanning(false);
      await c.useStill(SHOP);
      c.setScanning(true);
      await c.tick(true);
      expect(session.open).toBe(false);
      expect(reads()).toBe(0);   // no tooltip on a shop list, and the list is not read
      expect(c.status().html).not.toContain('shop');
      expect(c.status().html).toContain('Scanning your items');
    });

    it("can't scan with nothing to read", () => {
      const { c } = setup();
      c.setMode('inventory');
      expect(c.setScanning(true)).toBe(false);
      expect(c.collector.scanning).toBe(false);
    });

    it('says scanning is off when it is', async () => {
      const { c } = setup();
      c.setMode('inventory');
      await c.useStill(SCROLL);
      expect(c.status()).toEqual({ state: 'idle', html: expect.stringContaining('Not scanning your items') });
    });
  });

  describe('switching modes', () => {
    it('closes the open shop on the way to inventory', async () => {
      const { c, e, session, changes } = setup();
      await c.useStill(SHOP);
      session.hover = { key: 'traus', name: 'Traus', summary: '', mult: 1, ts: 0, rec: null };
      const v = session.version;
      changes.length = 0;
      c.setMode('inventory');
      expect(session.open).toBe(false);
      expect(session.hover).toBeNull();
      expect(session.version).toBeGreaterThan(v);
      expect(changes).toContain('shop');
      expect(e.settings.mode).toBe('inventory');
    });

    it('pauses scanning your items on the way to deals', async () => {
      const { c, collector, changes } = setup();
      c.setMode('inventory');
      await c.useStill(SCROLL);
      c.setScanning(true);
      changes.length = 0;
      c.setMode('deals');
      expect(collector.scanning).toBe(false);
      expect(changes).toContain('hover');
    });

    it('does nothing when the mode is the same', async () => {
      const { c, changes } = setup();
      c.setMode('deals');
      expect(changes).toEqual([]);
    });
  });

  describe('telling what changed', () => {
    it('tells of a changed shop, and not of an unchanged screen', async () => {
      const { c, changes, session } = setup();
      await c.useStill(SHOP);
      expect(changes).toContain('shop');
      const v = session.version;
      changes.length = 0;
      for (let i = 0; i < 10; i++) await c.tick();
      expect(session.version).toBe(v);
      expect(changes.filter((x) => x !== 'checked')).toEqual([]);
      expect(changes.filter((x) => x === 'checked')).toHaveLength(10);
    });

    it('counts every check', async () => {
      const { c } = setup();
      c.setMode('inventory');
      await c.useStill(SCROLL);
      const n = c.scans;
      await c.tick();   // not scanning: still a check
      expect(c.scans).toBe(n + 1);
    });
  });

  describe('capture', () => {
    it('starts the ticker at the check interval, and again when it changes', async () => {
      const { c, e, ticker } = setup();
      expect(await c.startCapture()).toBe(true);
      expect(ticker.ms).toBe(800);
      e.settings.interval = 2;
      c.restartTicker();
      expect(ticker.ms).toBe(2000);
      c.stopCapture();
      expect(ticker.stopped).toBe(1);
      expect(c.status().html).toContain('Not capturing');
    });

    it('says why a capture did not start', async () => {
      const { c, capture, changes } = setup();
      capture.fail = new CaptureFailed('cancelled', 'NotAllowedError');
      expect(await c.startCapture()).toBe(false);
      expect(c.error).toContain('Capture was cancelled');
      expect(c.error).toContain('(NotAllowedError)');
      expect(changes).toContain('status');
      capture.fail = null;
      await c.startCapture();
      expect(c.error).toBeNull();
    });

    it('closes the shop and pauses scanning when capture stops', async () => {
      const { c, capture, session, collector } = setup();
      await c.startCapture();
      await c.tick(true);
      await c.tick(true);   // a live share wants two reads to agree
      expect(session.open).toBe(true);
      c.setMode('inventory');
      capture.frame = SCROLL;
      c.setScanning(true);
      c.stopCapture();
      expect(collector.scanning).toBe(false);
      expect(c.canScan).toBe(false);
    });
  });
});
