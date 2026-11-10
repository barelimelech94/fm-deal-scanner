import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
import { engine, ITEMS, NOW } from './helpers/market';
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
function setup(o: { region?: Region | null; items?: Region | null } = {}) {
  let clock = NOW;
  const e = engine({ now: () => clock, items: [...ITEMS, ...HOVER_ITEMS.filter((it) => !ITEMS.some((x) => x.n === it.n))] });
  const data: AppraisalData = { entries: [] };
  const session = new ShopSession(e), collector = new HoverCollector(e, data);
  const reads: string[] = [];
  let lines: OcrLine[] = SHOP_LINES;
  /** while set, the next read waits for it to be let go */
  let held: { done: Promise<void>; go: () => void } | null = null;
  const reader = {
    ready: true,
    async load() {},
    async recognize(img: Buffer) {
      reads.push(String(img.length));
      const h = held;
      held = null;
      if (h) await h.done;
      return lines;
    },
  };
  const capture = new FakeCapture();
  const ticker = { ms: 0, started: 0, stopped: 0 };
  const shop = new Scanner(pixelsAdapter, reader, session, e);
  const c = new ScanController<Pixels, Buffer>({
    engine: e, capture, reader, session, collector,
    repeat: () => ({ start: (ms) => { ticker.ms = ms; ticker.started++; }, stop: () => { ticker.stopped++; } }),
    shop,
    hovers: new HoverScanner(pixelsAdapter, reader, collector, e),
    shopRegion: () => o.region ?? null,
    itemsArea: () => o.items ?? null,
  });
  const changes: ScanChange['kind'][] = [];
  c.on((x) => changes.push(x.kind));
  return {
    e, c, data, session, collector, capture, ticker, changes, shop,
    /** moves the clock the scanner reads the time from */
    advance: (ms: number) => { clock += ms; },
    reads: () => reads.length,
    answer: (l: OcrLine[]) => { lines = l; },
    /** Holds the next read until the returned function is called. */
    hold: () => { let go = () => {}; const done = new Promise<void>((r) => { go = r; }); held = { done, go }; return () => go(); },
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

    it('drops a hover read in inventory that ends after the switch to deals', async () => {
      const { c, data, collector, changes, reads, answer, hold } = setup();
      answer(SCROLL_LINES);
      c.setMode('inventory');
      await c.useStill(SCROLL);
      const release = hold();
      c.setScanning(true);   // starts a check, which waits in the reader
      await vi.waitFor(() => expect(reads()).toBe(1));
      c.setMode('deals');
      const v = collector.version;
      changes.length = 0;
      release();
      await c.tick();
      expect(data.entries).toEqual([]);
      expect(collector.version).toBe(v);
      expect(changes).not.toContain('hover');
    });

    it('drops a shop read in deals that ends after the switch to inventory', async () => {
      const { c, e, session, changes, reads, hold } = setup();
      const release = hold();
      const reading = c.useStill(SHOP);
      await vi.waitFor(() => expect(reads()).toBe(1));
      c.setMode('inventory');
      const v = session.version;
      changes.length = 0;
      release();
      await reading;
      await c.tick();
      expect(session.open).toBe(false);
      expect(session.rows.size).toBe(0);
      expect(session.hover).toBeNull();
      expect(session.version).toBe(v);
      expect(e.book.items).toEqual({});
      expect(changes).not.toContain('shop');
    });

    it('drops a hover read that ends after scanning was paused', async () => {
      const { c, data, reads, answer, hold } = setup();
      answer(SCROLL_LINES);
      c.setMode('inventory');
      await c.useStill(SCROLL);
      const release = hold();
      c.setScanning(true);
      await vi.waitFor(() => expect(reads()).toBe(1));
      c.setScanning(false);
      release();
      await c.tick();
      expect(data.entries).toEqual([]);
    });

    it('drops a shop read that ends after capture stopped', async () => {
      const { c, session, reads, hold } = setup();
      await c.startCapture();
      await c.tick(true);
      await c.tick(true);   // a live share wants two reads to agree
      expect(session.open).toBe(true);
      const n = reads(), release = hold();
      const reading = c.tick(true);
      await vi.waitFor(() => expect(reads()).toBe(n + 1));
      c.stopCapture();
      const v = session.version;
      release();
      await reading;
      expect(session.open).toBe(false);
      expect(session.rows.size).toBe(0);
      expect(session.version).toBe(v);
      expect(session.recheck).toBe(false);   // nothing from it waits for a second read either
    });

    it('drops a read of the screenshot before once a new one is picked', async () => {
      const { c, session, reads, hold } = setup();
      await c.useStill(SHOP);
      const n = reads(), release = hold();
      const reading = c.tick(true);   // the old screenshot, waiting in the reader
      const queued = c.tick(true);    // and one more of it, asked for meanwhile
      await vi.waitFor(() => expect(reads()).toBe(n + 1));
      const picked = c.useStill(SCROLL);   // a screenshot with no shop
      release();
      await Promise.all([reading, queued, picked]);
      await c.tick();
      expect(session.open).toBe(false);
      expect(session.rows.size).toBe(0);
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

    describe('an unchanged screen', () => {
      it('is read again once the last read is 3 seconds old, while a shop is open', async () => {
        const { c, reads, advance } = setup();
        await c.useStill(SHOP);
        expect(reads()).toBe(1);
        advance(2999);
        await c.tick();
        expect(reads()).toBe(1);
        advance(1);
        await c.tick();
        expect(reads()).toBe(2);
      });

      it('is never read again with no shop open', async () => {
        const { c, session, reads, advance } = setup();
        await c.useStill(SCROLL);
        expect(session.open).toBe(false);
        expect(reads()).toBe(1);
        advance(60_000);
        await c.tick();
        expect(reads()).toBe(1);
      });

      it('has its 3 seconds start over with any read', async () => {
        const { c, reads, advance } = setup();
        await c.useStill(SHOP);
        advance(2000);
        await c.tick(true);   // a read for another reason
        expect(reads()).toBe(2);
        advance(2000);
        await c.tick();
        expect(reads()).toBe(2);   // 4 s after the first read, 2 s after the last
        advance(1000);
        await c.tick();
        expect(reads()).toBe(3);
      });
    });

    it('reads a new screenshot even while a check of the one before is under way', async () => {
      const { c, session, answer } = setup();
      answer(SCROLL_LINES);
      await c.useStill(SCROLL);
      answer(SHOP_LINES);
      const before = c.tick(true);   // still reading the scroll
      await c.useStill(SHOP);
      await before;
      expect(session.open).toBe(true);
    });

    it('runs one forced check after the one under way, however many are asked for', async () => {
      const { c, reads } = setup();
      await c.useStill(SHOP);
      const n = reads();
      await Promise.all([c.tick(true), c.tick(true), c.tick(true), c.tick()]);
      expect(reads() - n).toBe(2);   // the one under way, and one more
    });

    it('gets over a check that failed: a forced check asked for later still runs', async () => {
      const { c, shop, reads, hold } = setup();
      await c.useStill(SHOP);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(shop, 'prepare').mockImplementationOnce(() => { throw new Error('no 2d canvas'); });
      // a check that fails, with a forced one asked for while it runs
      await expect(Promise.all([c.tick(true), c.tick(true)])).resolves.toBeDefined();
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
      const n = reads();
      const release = hold();
      const later = c.tick(true);   // waits in the reader
      const queued = c.tick(true);  // asked for while it runs: runs after it
      release();
      await expect(Promise.all([later, queued])).resolves.toBeDefined();
      expect(reads() - n).toBe(2);
    });

    it('says so when the screen could not be read several checks running, and not after one', async () => {
      const { c, shop, changes } = setup();
      await c.useStill(SHOP);
      const ok = c.status();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failing = vi.spyOn(shop, 'prepare').mockImplementation(() => { throw new Error('no 2d canvas'); });
      changes.length = 0;
      await c.tick(true);
      await c.tick(true);
      expect(c.status()).toEqual(ok);   // once or twice: nothing said
      expect(changes).not.toContain('status');
      await c.tick(true);
      expect(c.status()).toEqual({ state: 'busy', html: "<b>Can't read the screen.</b> Stop and start capture again, or reload the page." });
      expect(changes).toContain('status');
      expect(logged).toHaveBeenCalledTimes(3);
      // it reads again: the status says what it reads
      failing.mockRestore();
      logged.mockRestore();
      changes.length = 0;
      await c.tick(true);
      expect(c.status()).toMatchObject({ state: 'shop', html: expect.stringContaining('6 listings') });
      expect(changes).toContain('status');
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

  describe('troubleshooting', () => {
    it("shows what the mode read last: the shop list in deals, your item's tooltip in inventory", async () => {
      const { c, shop, answer } = setup();
      expect(c.seen).toBeNull();
      await c.useStill(SHOP);
      const list = shop.lastCrop;
      expect(list).not.toBeNull();
      expect(c.seen).toBe(list);
      c.setMode('inventory');
      expect(c.seen).toBeNull();   // no item read yet: not the shop's list
      answer(SCROLL_LINES);
      await c.useStill(SCROLL);
      c.setScanning(true);
      await c.tick();
      expect(c.seen).not.toBeNull();
      expect(c.seen).not.toBe(list);
      c.setMode('deals');
      expect(c.seen).toBe(list);
    });

    it('says what the mode reads: the shop list and how its area is found, or your items and where', async () => {
      const shop = setup();
      expect(shop.c.readTarget()).toBe('shop-looking');
      await shop.c.useStill(SHOP);
      expect(shop.c.readTarget()).toBe('shop-found');
      shop.c.setMode('inventory');
      expect(shop.c.readTarget()).toBe('paused');
      shop.c.setScanning(true);
      expect(shop.c.readTarget()).toBe('items');

      const marked = setup({ region: { x: 0, y: 0, w: 1, h: 1 }, items: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } });
      marked.e.settings.area = 'manual';
      expect(marked.c.readTarget()).toBe('shop-marked');
      await marked.c.useStill(SCROLL);
      marked.c.setMode('inventory');
      marked.c.setScanning(true);
      expect(marked.c.readTarget()).toBe('items-marked');
      const unset = setup();
      unset.e.settings.area = 'manual';
      expect(unset.c.readTarget()).toBe('shop-unset');
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

    it('tells the status changed when capture starts, even with the same words', async () => {
      const { c, changes, hold } = setup();
      await c.useStill(SHOP);
      const before = c.status();
      changes.length = 0;
      hold();   // the first check of the share waits in the reader, so the words stay as they are
      await c.startCapture();
      expect(c.status()).toEqual(before);
      expect(changes).toContain('status');
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
