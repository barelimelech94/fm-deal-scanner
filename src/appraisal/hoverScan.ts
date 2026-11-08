import type { Engine } from '../engine';
import type { Region } from '../lib/types';
import type { FrameAdapter, Ocr } from '../scan/scanner';
import { tooltipResolver } from '../tooltip/resolve';
import { prepareHover, readHover, type HoverCrop } from './hover';
import type { HoverCollector, HoverEvent, HoverSpot } from './hovers';

/** How far from the marked area a tooltip may sit and still be for an item in it, as a fraction of the frame. */
export const AREA_MARGIN = 0.03;

/** The slot is about this much wider than the item picture in its tooltip: 48.5 against 92 at the reference size. */
const SLOT_PER_ICON = 48.5 / 92;

/** Whether a tooltip box touches the marked area, widened: the tooltip opens beside the item it is for. */
export function nearArea(box: Region, area: Region, margin = AREA_MARGIN): boolean {
  return box.x < area.x + area.w + margin && box.x + box.w > area.x - margin && box.y < area.y + area.h + margin && box.y + box.h > area.y - margin;
}

/** The part of a frame's reading done at once, so the frame can be let go before the slow reading starts. */
export interface HoverPrep<I> { crop: HoverCrop<I>; spot: HoverSpot }

export interface HoverScanOptions {
  /** a live screen share: a tooltip must stay for two checks. A still screenshot is read at once. */
  live: boolean;
  /** count only tooltips near this area, when set */
  area: Region | null;
}

/** One pass over a frame for the appraisal: find the hovered tooltip, read it, and hand the item to the collector. */
export class HoverScanner<F, I> {
  busy = false;
  /** for troubleshooting: what the reader saw last */
  lastLines: string[] = [];

  constructor(
    private readonly adapter: FrameAdapter<F, I>,
    private readonly ocr: Ocr<I>,
    private readonly collector: HoverCollector,
    private readonly e: Engine,
  ) {}

  /** The quick part. Null when there is nothing to read yet: no tooltip, one elsewhere, or one still settling. */
  prepare(frame: F, o: HoverScanOptions): HoverPrep<I> | null {
    const crop = prepareHover(this.adapter, frame);
    if (!crop || (o.area && !nearArea(crop.box, o.area))) { this.collector.noTooltip(); return null; }
    if (!this.collector.due(crop.sig, o.live)) return null;
    return { crop, spot: { x: crop.box.px.x, y: crop.box.px.y, pitch: (crop.side ?? 92) * SLOT_PER_ICON } };
  }

  /** The slow part: reads the tooltip and puts the item on the appraisal. */
  async read(p: HoverPrep<I>): Promise<HoverEvent> {
    this.busy = true;
    try {
      const { tip, lines } = await readHover(this.ocr, p.crop, tooltipResolver(this.e));
      this.lastLines = lines;
      return tip ? this.collector.ingest(tip, p.spot) : this.collector.unreadable(lines);
    } finally { this.busy = false; }
  }

  async scan(frame: F, o: HoverScanOptions): Promise<HoverEvent | null> {
    const p = this.prepare(frame, o);
    return p ? this.read(p) : null;
  }
}
