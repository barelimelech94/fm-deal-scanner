import type { Region } from '../lib/types';
import type { Scaled } from './pixels';

/**
 * A hover tooltip is a see-through dark blue box. Over any map it stays blue-dominant: violet over orange
 * bricks (about 60,45,80), almost black-blue over black (10,11,59), bluer and lighter over bright scenery
 * (up to about 115,115,160). Bricks, trees
 * and the grey-white of windows are never blue-dominant, which is what finds it, whatever item it is for.
 */
export const isTipFill = (r: number, g: number, b: number): boolean =>
  b >= 40 && b <= 190 && b - r >= 12 && b - g >= 18 && r <= 135 && g <= 135;

/** The width the frame is examined at: the box is large, so this much detail is plenty. */
export const TOOLTIP_BOX_WIDTH = 1000;

/** The smallest tooltip, as a fraction of the examined frame's width: a scroll's is about 15%. */
const MIN_W = 0.09, MIN_H = 0.06;

export interface TipBox extends Region {
  /** left edge as a fraction of the frame's height, for comparing positions in pixels */
  px: { x: number; y: number; w: number; h: number };
}

/** Bridges runs of `false` no longer than `gap` that sit between two runs of `true`, along one line. */
function bridge(m: Uint8Array, start: number, step: number, n: number, gap: number): void {
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!m[start + i * step]) continue;
    if (last >= 0 && i - last - 1 > 0 && i - last - 1 <= gap) for (let k = last + 1; k < i; k++) m[start + k * step] = 1;
    last = i;
  }
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Finds the tooltip boxes in a frame, left to right. Text and the item picture leave holes in the blue,
 * so small gaps in it are bridged first; each blue blob is then trimmed back to where it is really dense
 * (a thin spur of blue scenery doesn't stretch the box), and a blob made of two tooltips side by side is
 * cut where the blue stops between them.
 */
export function findTooltipBoxes({ px, scale: s, fw, fh }: Scaled): TipBox[] {
  const { data: d, width: W, height: H } = px;
  if (!W || !H) return [];
  const m = new Uint8Array(W * H);
  let any = 0;
  for (let i = 0, p = 0; p < m.length; i += 4, p++) if (isTipFill(d[i]!, d[i + 1]!, d[i + 2]!)) { m[p] = 1; any++; }
  if (any < MIN_W * W * MIN_H * H * 0.2) return [];

  const gap = Math.max(2, Math.round(W / 330));
  const c = Uint8Array.from(m);
  for (let y = 0; y < H; y++) bridge(c, y * W, 1, W, gap);
  for (let x = 0; x < W; x++) bridge(c, x, W, H, gap);

  // solid cores: where a small window is mostly blue. Thin strips of blue scenery have none, so they can't
  // join a tooltip to something else
  const R = Math.max(2, Math.round(W / 250)), I = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += c[y * W + x]!; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1]! + row; }
  }
  const dense = new Uint8Array(W * H);
  for (let y = R; y < H - R; y++) {
    for (let x = R; x < W - R; x++) {
      const n = I[(y + R + 1) * (W + 1) + x + R + 1]! - I[(y - R) * (W + 1) + x + R + 1]! - I[(y + R + 1) * (W + 1) + x - R]! + I[(y - R) * (W + 1) + x - R]!;
      if (n >= 0.55 * (2 * R + 1) ** 2) dense[y * W + x] = 1;
    }
  }
  const seen = new Uint8Array(W * H), rects: Rect[] = [], stack: number[] = [];
  for (let p0 = 0; p0 < dense.length; p0++) {
    if (!dense[p0] || seen[p0]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && dense[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && dense[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && dense[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && dense[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (x1 - x0 + 1 >= MIN_W * W - 2 * R && y1 - y0 + 1 >= MIN_H * H - 2 * R && n >= 0.35 * (x1 - x0 + 1) * (y1 - y0 + 1)) {
      rects.push({ x0: Math.max(0, x0 - R), y0: Math.max(0, y0 - R), x1: Math.min(W - 1, x1 + R), y1: Math.min(H - 1, y1 + R) });
    }
  }

  const out: Rect[] = [];
  for (const r of rects) for (const piece of split(m, W, trim(c, W, r))) {
    const t = trim(c, W, piece);
    if (t.x1 - t.x0 + 1 >= MIN_W * W && t.y1 - t.y0 + 1 >= MIN_H * H) out.push(t);
  }
  out.sort((a, b) => a.x0 - b.x0);
  return out.map((r) => {
    const X0 = r.x0 / s, Y0 = r.y0 / s, X1 = Math.min(fw, (r.x1 + 1) / s), Y1 = Math.min(fh, (r.y1 + 1) / s);
    return { x: X0 / fw, y: Y0 / fh, w: (X1 - X0) / fw, h: (Y1 - Y0) / fh, px: { x: Math.round(X0), y: Math.round(Y0), w: Math.round(X1 - X0), h: Math.round(Y1 - Y0) } };
  });
}

/** Pulls each edge in while its row or column is mostly not blue: the box is dense, scenery spurs are not. */
function trim(c: Uint8Array, W: number, r: Rect, need = 0.35): Rect {
  let { x0, y0, x1, y1 } = r;
  const col = (x: number) => { let n = 0; for (let y = y0; y <= y1; y++) n += c[y * W + x]!; return n / (y1 - y0 + 1); };
  const row = (y: number) => { let n = 0; for (let x = x0; x <= x1; x++) n += c[y * W + x]!; return n / (x1 - x0 + 1); };
  for (let moved = true; moved && x1 > x0 && y1 > y0;) {
    moved = false;
    if (col(x0) < need) { x0++; moved = true; }
    if (col(x1) < need) { x1--; moved = true; }
    if (row(y0) < need) { y0++; moved = true; }
    if (row(y1) < need) { y1--; moved = true; }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Cuts a rectangle where the blue dips sharply for a few columns: two tooltips side by side (the item you
 * point at and the one you are wearing) touch or leave a gap of a few pixels, whose edges stay dark. The dip
 * is narrow, unlike the item picture, whose wide pale square lowers the blue over many columns.
 */
function split(m: Uint8Array, W: number, r: Rect): Rect[] {
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1, side = Math.max(4, Math.round(W / 90)), minPart = MIN_W * W * 0.6;
  const dens: number[] = [];
  for (let x = r.x0; x <= r.x1; x++) { let n = 0; for (let y = r.y0; y <= r.y1; y++) n += m[y * W + x]!; dens.push(n / h); }
  const avg = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += dens[i]!; return s / Math.max(1, b - a); };
  /** column i holds much less blue than the columns a little to either side */
  const notch = (i: number) => dens[i]! < 0.16 * (avg(i - 3 * side, i - side) + avg(i + side + 1, i + 3 * side + 1));
  const cuts: number[] = [];
  for (let i = Math.round(minPart); i < w - minPart; i++) {
    if (!notch(i)) continue;
    // the deepest column of this dip
    let best = i, j = i;
    while (j < w - minPart && notch(j)) { if (dens[j]! < dens[best]!) best = j; j++; }
    cuts.push(best);
    i = j;
  }
  if (!cuts.length) return [r];
  const out: Rect[] = [];
  let from = 0;
  for (const x of cuts) { out.push({ ...r, x0: r.x0 + from, x1: r.x0 + x - 1 }); from = x + 1; }
  out.push({ ...r, x0: r.x0 + from });
  return out;
}

/**
 * Of several boxes, the hovered item's. When the game shows what you are wearing beside the item you
 * point at, the two sit side by side and the hovered one is on the left, whichever side of the screen.
 */
export function hoveredBox<T extends { x: number; y: number; w: number; h: number }>(boxes: readonly T[]): T | null {
  if (!boxes.length) return null;
  let best = boxes[0]!;
  for (const b of boxes.slice(1)) {
    const lap = Math.min(b.y + b.h, best.y + best.h) - Math.max(b.y, best.y);
    const gap = Math.max(b.x, best.x) - Math.min(b.x + b.w, best.x + best.w);
    // side by side: level with each other and nearly touching
    const pair = lap > 0.6 * Math.min(b.h, best.h) && gap < 0.04;
    if (pair ? b.x < best.x : b.w * b.h > best.w * best.h) best = b;
  }
  return best;
}
