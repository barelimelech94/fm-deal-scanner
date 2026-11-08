import type { Pixels } from './pixels';

/** The item picture's frame is a pale grey square, whatever the item. */
const isPale = (r: number, g: number, b: number): boolean => Math.min(r, g, b) >= 165 && Math.max(r, g, b) - Math.min(r, g, b) <= 40;

/**
 * The side of the pale square holding the item's picture, in pixels. It is the same size in every tooltip
 * (in game pixels), which makes it a ruler that works for a scroll's short tooltip as well as an equip's
 * tall one. Null when no square is found.
 */
export function iconSide(px: Pixels): number | null {
  const { data: d, width: W, height: H } = px;
  if (W < 40 || H < 40) return null;
  // the picture is in the left half of the box
  const maxX = Math.floor(W * 0.5);
  const pale = new Uint8Array(maxX * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < maxX; x++) { const i = (y * W + x) * 4; if (isPale(d[i]!, d[i + 1]!, d[i + 2]!)) pale[y * maxX + x] = 1; }
  const seen = new Uint8Array(pale.length), stack: number[] = [];
  let best: { w: number; h: number } | null = null;
  for (let p0 = 0; p0 < pale.length; p0++) {
    if (!pale[p0] || seen[p0]) continue;
    let x0 = maxX, y0 = H, x1 = 0, y1 = 0;
    stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % maxX, y = (p - x) / maxX;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && pale[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < maxX - 1 && pale[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && pale[p - maxX] && !seen[p - maxX]) { seen[p - maxX] = 1; stack.push(p - maxX); }
      if (y < H - 1 && pale[p + maxX] && !seen[p + maxX]) { seen[p + maxX] = 1; stack.push(p + maxX); }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w >= 16 && h >= 16 && w / h > 0.8 && w / h < 1.25 && (!best || w * h > best.w * best.h)) best = { w, h };
  }
  return best ? Math.sqrt(best.w * best.h) : null;
}

/** In the screenshots the fixtures come from, the picture is 92 pixels across and the text lines 21.8 apart. */
const LINE_PER_ICON = 21.8 / 92;

/**
 * The distance between a tooltip's text lines, in pixels, from the size of its picture. The reader does
 * best with lines about 40 pixels apart, and a tooltip comes at any size, so this sets how much to enlarge it.
 */
export function textSpacing(px: Pixels): number | null {
  const side = iconSide(px);
  return side == null ? null : side * LINE_PER_ICON;
}
