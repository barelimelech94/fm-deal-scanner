import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import type { Pixels, Scaled } from '../../src/vision/pixels';

export const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

export function loadPng(name: string): Pixels {
  const png = PNG.sync.read(readFileSync(join(FIXTURES, 'img', name)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

/** Area-average resize, like a browser drawing a large frame into a smaller canvas. */
export function resize(src: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < src.height; yy++) {
        for (let xx = x0; xx < x1 && xx < src.width; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Mitchell-Netravali cubic (B = C = 1/3): what a browser's high-quality smoothing uses to enlarge. */
function mitchell(x: number): number {
  const B = 1 / 3, C = 1 / 3, t = Math.abs(x);
  if (t < 1) return ((12 - 9 * B - 6 * C) * t ** 3 + (-18 + 12 * B + 6 * C) * t ** 2 + (6 - 2 * B)) / 6;
  if (t < 2) return ((-B - 6 * C) * t ** 3 + (6 * B + 30 * C) * t ** 2 + (-12 * B - 48 * C) * t + (8 * B + 24 * C)) / 6;
  return 0;
}

/** Enlarges with bicubic filtering (for "the game window is bigger" cases, and the reader's crops). */
export function enlarge(src: Pixels, f: number): Pixels {
  const w = Math.round(src.width * f), h = Math.round(src.height * f);
  const W = src.width, H = src.height, d = src.data;
  // separable: rows first, then columns
  const tmp = new Float32Array(w * H * 3);
  const taps = (n: number, size: number) => {
    const c = (n + 0.5) / f - 0.5, i0 = Math.floor(c);
    const idx: number[] = [], wt: number[] = [];
    let sum = 0;
    for (let k = -1; k <= 2; k++) { const v = mitchell(c - (i0 + k)); idx.push(Math.min(size - 1, Math.max(0, i0 + k))); wt.push(v); sum += v; }
    return { idx, wt: wt.map((v) => v / sum) };
  };
  for (let x = 0; x < w; x++) {
    const { idx, wt } = taps(x, W);
    for (let y = 0; y < H; y++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += d[(y * W + idx[k]!) * 4 + c]! * wt[k]!;
        tmp[(y * w + x) * 3 + c] = v;
      }
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const { idx, wt } = taps(y, H);
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += tmp[(idx[k]! * w + x) * 3 + c]! * wt[k]!;
        out[(y * w + x) * 4 + c] = v;
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

export const scaleBy = (src: Pixels, f: number): Pixels => (f >= 1 ? enlarge(src, f) : resize(src, Math.round(src.width * f), Math.round(src.height * f)));

/** Places an image on a plain screen of the given size, like a game window somewhere on a desktop. */
export function placeOn(img: Pixels, w: number, h: number, x: number, y: number, bg: [number, number, number] = [52, 70, 48]): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  for (let yy = 0; yy < img.height && y + yy < h; yy++) {
    for (let xx = 0; xx < img.width && x + xx < w; xx++) {
      const s = (yy * img.width + xx) * 4, o = ((y + yy) * w + x + xx) * 4;
      out[o] = img.data[s]!; out[o + 1] = img.data[s + 1]!; out[o + 2] = img.data[s + 2]!;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * The text in a rectangle lightened towards white, the way the game greys out a listing that sold. Only pixels
 * darker than the cell are touched, so the cell keeps its colour. 0.4 to 0.48 of the way still reads (tried with
 * the real reader on shop-list.png at half size); much more and the price misreads.
 */
export function fadeText(img: Pixels, r: { x: number; y: number; w: number; h: number }, k = 0.44): Pixels {
  const out = new Uint8ClampedArray(img.data);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4;
      if (Math.max(out[i]!, out[i + 1]!, out[i + 2]!) >= 200) continue;
      for (let c = 0; c < 3; c++) out[i + c] = out[i + c]! + (255 - out[i + c]!) * k;
    }
  }
  return { data: out, width: img.width, height: img.height };
}

/** What the browser adapter hands the finders: the frame shrunk to at most `width` pixels wide. */
export function examine(frame: Pixels, width: number): Scaled {
  const s = Math.min(1, width / frame.width);
  const px = s < 1 ? resize(frame, Math.round(frame.width * s), Math.round(frame.height * s)) : frame;
  return { px, scale: s, fw: frame.width, fh: frame.height };
}
