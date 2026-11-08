import type { TooltipRead } from '../lib/types';
import type { FrameAdapter, Ocr } from '../scan/scanner';
import { parseTooltip, type ResolveName } from '../tooltip/parseTooltip';
import { thumbSignature, tooltipGray, toRect } from '../vision/preprocess';
import { findTooltipBoxes, hoveredBox, TOOLTIP_BOX_WIDTH, type TipBox } from '../vision/tooltipBox';
import { iconSide, textSpacing } from '../vision/tooltipText';

/** The reader does best with tooltip text lines about this many pixels apart. */
export const HOVER_LINE_PX = 52;
const hoverScale = (spacing: number): number => Math.max(1, Math.min(3.5, HOVER_LINE_PX / spacing));

/** What is taken from one frame of a hover: the tooltip of the item the mouse is on, ready to read. */
export interface HoverCrop<I> {
  image: I;
  sig: Float32Array;
  box: TipBox;
  /** the item picture's side in frame pixels: a slot is about half as wide again */
  side: number | null;
}

/**
 * The quick part, like the shop's: finds the hovered tooltip and copies it, enlarged to suit the reader.
 * Synchronous, so the frame can be let go before the slow reading starts. Null when no tooltip is showing.
 */
export function prepareHover<F, I>(adapter: FrameAdapter<F, I>, frame: F): HoverCrop<I> | null {
  const { w: fw, h: fh } = adapter.size(frame);
  const box = hoveredBox(findTooltipBoxes(adapter.examine(frame, TOOLTIP_BOX_WIDTH)));
  if (!box) return null;
  const rect = toRect(box, fw, fh);
  if (rect.sw < 40 || rect.sh < 40) return null;
  const plain = adapter.crop(frame, rect, 1);
  const spacing = textSpacing(plain);
  const px = adapter.crop(frame, rect, hoverScale(spacing ?? 21));
  tooltipGray(px);
  return { image: adapter.toImage(px), sig: thumbSignature(px), box, side: iconSide(plain) };
}

/** The slow part: reads the copy and makes sense of it. Null when it isn't an item tooltip. */
export async function readHover<I>(ocr: Ocr<I>, crop: HoverCrop<I>, resolve: ResolveName): Promise<{ tip: TooltipRead | null; lines: string[] }> {
  const lines = await ocr.recognize(crop.image);
  return { tip: parseTooltip(lines, resolve, { bare: true }), lines: lines.map((l) => l.text.trim()).filter(Boolean) };
}
