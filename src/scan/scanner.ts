import type { Engine } from '../engine';
import type { OcrLine, Region } from '../lib/types';
import { parseLines, type GrayImage } from '../listing/parseListing';
import { resolveKey } from '../market/matching';
import type { ShopSession } from '../shop/session';
import { parseTooltip, type ResolveName } from '../tooltip/parseTooltip';
import { findTooltip, tooltipExamineWidth, type TooltipBox } from '../vision/findTooltip';
import { gamePixel, LOCATE_WIDTH, locateShop } from '../vision/locateShop';
import type { Pixels, Scaled } from '../vision/pixels';
import {
  listGray, listScale, MIN_LIST_PX, MIN_TOOLTIP_PX, thumbSignature, toRect, tooltipGray, tooltipScale, type Rect,
} from '../vision/preprocess';
import { sigDiff, signature } from '../vision/signature';

/**
 * What the scanner needs from wherever frames come from: canvas and VideoFrame in the browser,
 * plain pixel arrays in tests. `I` is whatever the text reader takes.
 */
export interface FrameAdapter<F, I> {
  size(frame: F): { w: number; h: number };
  /** the whole frame shrunk to at most `width` pixels wide */
  examine(frame: F, width: number): Scaled;
  /** a rectangle of the frame scaled by `scale`; the caller may change the pixels */
  crop(frame: F, rect: Rect, scale: number): Pixels;
  /** pixels, as something the reader takes */
  toImage(px: Pixels): I;
}

export interface Ocr<I> { recognize(image: I): Promise<OcrLine[]> }

export interface ScanOptions {
  /** find the list by itself; otherwise read `region` */
  auto: boolean;
  region: Region | null;
  readStats: boolean;
  /** frames of a live screen share, which must agree twice; false for a still screenshot */
  live: boolean;
  /** read even if the screen looks unchanged */
  force?: boolean;
}

interface ListCrop<I> { image: I; gray: GrayImage; region: Region }
interface TipCrop<I> { image: I; sig: Float32Array; box: TooltipBox }

/** Everything taken from one frame, so the frame can be let go before the slow reading starts. */
export interface Prepared<I> { list: ListCrop<I> | null; tip: TipCrop<I> | null; opts: ScanOptions }

export interface ScannerHooks {
  /** the price book changed and should be saved */
  onBook?: () => void;
}

/** One pass over a frame: find the list and any tooltip, read them, and hand the results to the shop. */
export class Scanner<F, I> {
  /** where the list was found in the last frame */
  found: Region | null = null;
  /** screen pixels per game pixel, from the last list found */
  gamePx: number | null = null;
  /** for troubleshooting: what the reader saw last */
  lastLines: string[] = [];
  lastTipLines: string[] | null = null;
  lastCrop: I | null = null;
  ocrMs = 0;
  private lastSig: Float32Array | null = null;
  private tipSig: Float32Array | null = null;

  constructor(
    private readonly adapter: FrameAdapter<F, I>,
    private readonly ocr: Ocr<I>,
    private readonly session: ShopSession,
    private readonly e: Engine,
    private readonly hooks: ScannerHooks = {},
  ) {}

  /** Forget what was read last, so the next frame is read whatever it shows. */
  reset(): void { this.lastSig = null; this.tipSig = null; this.lastTipLines = null; }

  /** The quick part: finds and copies what to read. Synchronous, so the frame can be closed right after. */
  prepare(frame: F, opts: ScanOptions): Prepared<I> {
    const { w: fw, h: fh } = this.adapter.size(frame);
    const region = opts.auto ? locateShop(this.adapter.examine(frame, LOCATE_WIDTH)) : opts.region;
    this.found = region;
    if (region && opts.auto) this.gamePx = gamePixel(region, fw);

    let list: ListCrop<I> | null = null;
    if (region) {
      const rect = toRect(region, fw, fh);
      if (rect.sw >= MIN_LIST_PX && rect.sh >= MIN_LIST_PX) {
        const px = this.adapter.crop(frame, rect, listScale(rect.sw));
        const gray = listGray(px);
        list = { image: this.adapter.toImage(px), gray, region };
      }
    }

    let tip: TipCrop<I> | null = null;
    if (opts.readStats) {
      const box = findTooltip(this.adapter.examine(frame, tooltipExamineWidth(fw, this.gamePx)));
      const rect = box && toRect(box, fw, fh);
      if (box && rect && rect.sw >= MIN_TOOLTIP_PX && rect.sh >= MIN_TOOLTIP_PX) {
        const px = this.adapter.crop(frame, rect, tooltipScale(box.sp));
        tooltipGray(px);
        tip = { image: this.adapter.toImage(px), sig: thumbSignature(px), box };
      }
    }
    return { list, tip, opts };
  }

  /** The slow part: reads the copies and updates the shop. */
  async read(p: Prepared<I>): Promise<void> {
    await this.readList(p.list, p.opts, !!p.tip);
    if (p.tip) await this.readTooltip(p.tip);
  }

  async scan(frame: F, opts: ScanOptions): Promise<void> { await this.read(this.prepare(frame, opts)); }

  private async readList(list: ListCrop<I> | null, opts: ScanOptions, covered: boolean): Promise<void> {
    if (!list) {
      // no list on screen: an open shop counts as closed after two looks, unless a tooltip covers it
      this.lastSig = null;
      if (covered) this.session.covered();
      else this.session.read([], opts.live);
      return;
    }
    this.lastCrop = list.image;
    const sig = signature(list.gray.gray, list.gray.w, list.gray.h);
    // an unchanged screen is skipped, unless a new listing is waiting for its second read
    if (!opts.force && !this.session.recheck && this.lastSig && sigDiff(sig, this.lastSig) < 2) return;
    this.lastSig = sig;
    const t0 = performance.now();
    let lines: OcrLine[] = [];
    try { lines = await this.ocr.recognize(list.image); }
    finally { this.ocrMs = performance.now() - t0; }
    this.lastLines = lines.map((l) => `${Math.round(l.confidence)} ${l.text.trim()}`);
    const rows = parseLines(lines, list.gray);
    const { region, gray } = list;
    for (const r of rows) if (r.cy != null) r.fy = region.y + (r.cy / gray.h) * region.h;   // where the row sits on screen
    if (!rows.length && covered) { this.session.covered(); return; }   // a tooltip over the list hides rows
    if (this.session.read(rows, opts.live)) this.hooks.onBook?.();
  }

  private async readTooltip(tip: TipCrop<I>): Promise<void> {
    if (this.tipSig && sigDiff(tip.sig, this.tipSig) < 2) return;   // the same tooltip as last time
    this.tipSig = tip.sig;
    const lines = await this.ocr.recognize(tip.image);
    this.lastTipLines = lines.map((l) => l.text.trim());
    const t = parseTooltip(lines, this.resolveName);
    if (t && this.session.applyTooltip(t, tip.box.anchor)) this.hooks.onBook?.();
  }

  private readonly resolveName: ResolveName = (name) => {
    const key = resolveKey({ market: this.e.market, book: this.e.book }, name, false);
    return { key, known: this.e.market.knownName(key) };
  };
}
