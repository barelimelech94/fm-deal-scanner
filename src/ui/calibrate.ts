import type { Grab } from '../capture/screen';
import { fmt } from '../lib/format';
import type { Region } from '../lib/types';
import { parseLines } from '../listing/parseListing';
import type { Ocr } from '../scan/scanner';
import { canvasAdapter, frameSize, isBlack, snapshot } from '../vision/canvas';
import { LOCATE_WIDTH, locateShop } from '../vision/locateShop';
import { listGray, listScale, toRect } from '../vision/preprocess';
import { $ } from './dom';

/** What the dialog marks: the shop's item list (read for prices) or the area of items whose hovers count. */
export type AreaKind = 'shop' | 'items';

export interface CalibrationHost {
  grab(): Promise<Grab | null>;
  capturing(): boolean;
  sharingWholeScreen(): boolean;
  framesIn(): number;
  auto(): boolean;
  region(kind: AreaKind): Region | null;
  ocr: Ocr<HTMLCanvasElement> & { load(): Promise<unknown> };
  save(r: Region, kind: AreaKind): void;
  chime(): void;
}

const TEXT: Record<AreaKind, { title: string; intro: string; ready: string; none: string; first: string }> = {
  shop: {
    title: "Mark the shop's item list",
    intro: "Open a player shop or hired merchant in the game, then drag a box over the item names and prices. Leave out the item icons and the scroll bar. You only need this if the scanner can't find the list on its own. A marked area stays put, so mark it again after resizing the game.",
    ready: 'Found the shop list on its own (the box). Press Test read to check it. Saving a box of your own turns automatic finding off.',
    none: "If it doesn't show the game with a shop open, press Grab in 5 s and switch to the game. Otherwise drag a box over the shop's item names and prices.",
    first: 'Drag a box over the item list first.',
  },
  items: {
    title: 'Mark the area of items',
    intro: 'Open your inventory, the trade window or storage in the game, then drag a box over the item slots. While scanning, only tooltips beside this box are counted, so hovering the chat, the map or other windows adds nothing. A marked area stays put, so mark it again after moving the window.',
    ready: '',
    none: 'If it does not show the game with the item window open, press Grab in 5 s and switch to the game. Then drag a box over the item slots.',
    first: 'Drag a box over the item slots first.',
  },
};

/** The "Mark shop area" dialog: a still of the screen to drag a box on, and a test read of it. */
export class Calibration {
  private frame: HTMLCanvasElement | null = null;
  private rect: Region | null = null;
  private drag: { x: number; y: number } | null = null;
  private countdown = false;
  private kind: AreaKind = 'shop';

  constructor(private readonly host: CalibrationHost) {
    const cv = $<HTMLCanvasElement>('calibCanvas');
    cv.addEventListener('pointerdown', (e) => { this.drag = this.point(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const p = this.point(e), a = this.drag;
      this.rect = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
      this.draw();
    });
    cv.addEventListener('pointerup', () => { this.drag = null; });
    $('calibGrab').addEventListener('click', () => void this.grab());
    $('calibLater').addEventListener('click', () => void this.grabIn(5));
    $('calibCancel').addEventListener('click', () => this.close());
    $('calibTest').addEventListener('click', () => void this.test());
    $('calibSave').addEventListener('click', () => this.save());
  }

  async open(kind: AreaKind = 'shop'): Promise<void> {
    this.kind = kind;
    $('hCalib').textContent = TEXT[kind].title;
    $('calibText').textContent = TEXT[kind].intro;
    $('calibTest').hidden = kind === 'items';
    $('calib').hidden = false;
    const r = this.host.region(kind);
    this.rect = r ? { ...r } : null;
    // a shared screen shows this page right now, so give time to switch to the game
    if (this.host.sharingWholeScreen()) await this.grabIn(5);
    else await this.grab();
  }

  close(): void { $('calib').hidden = true; }

  private out(text: string): void { $('calibOut').textContent = text; }

  private point(e: PointerEvent) {
    const b = $<HTMLCanvasElement>('calibCanvas').getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  }

  async grab(): Promise<boolean> {
    const g = await this.host.grab();
    if (!g) {
      this.out(this.host.capturing()
        ? `The share is on but no picture has arrived yet (${this.host.framesIn()} frames). Switch to the game for a second so the screen changes, then press Grab now.`
        : 'No picture yet. Start capture or load a screenshot first.');
      return false;
    }
    let found: Region | null = null, black = false;
    try {
      this.frame = snapshot(g.frame);
      black = isBlack(g.frame);
      // start from the list the scanner finds on its own, when it finds one
      if (this.kind === 'shop' && (this.host.auto() || !this.rect)) found = locateShop(canvasAdapter.examine(g.frame, LOCATE_WIDTH));
    } finally { g.done(); }
    if (found) this.rect = found;
    const cv = $<HTMLCanvasElement>('calibCanvas');
    cv.width = this.frame.width; cv.height = this.frame.height;
    this.draw();
    if (black) {
      $('calibOut').innerHTML = 'The picture is black. macOS is blocking the capture: in System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, turn Chrome off and on, quit Chrome with ⌘Q, reopen it and start again.';
    } else {
      this.out(found ? TEXT[this.kind].ready : `Got a ${cv.width}×${cv.height} picture. ${TEXT[this.kind].none}`);
    }
    return true;
  }

  async grabIn(sec: number): Promise<void> {
    if (this.countdown) return;
    this.countdown = true;
    const btn = $('calibLater');
    try {
      for (let s = sec; s > 0; s--) {
        btn.textContent = `Grabbing in ${s}…`;
        this.out(`Switch to the game and open ${this.kind === 'shop' ? 'a shop' : 'your inventory'} now. The picture is taken in ${s} s, then come back here.`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      this.countdown = false;
      btn.textContent = 'Grab in 5 s';
    }
    if (await this.grab()) this.host.chime();
  }

  private draw(): void {
    const cv = $<HTMLCanvasElement>('calibCanvas'), ctx = cv.getContext('2d');
    if (!this.frame || !ctx) return;
    ctx.drawImage(this.frame, 0, 0);
    const r = this.rect;
    if (!r) return;
    const W = cv.width, H = cv.height;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, W, r.y * H);
    ctx.fillRect(0, (r.y + r.h) * H, W, H - (r.y + r.h) * H);
    ctx.fillRect(0, r.y * H, r.x * W, r.h * H);
    ctx.fillRect((r.x + r.w) * W, r.y * H, W - (r.x + r.w) * W, r.h * H);
    ctx.strokeStyle = '#f0b43a';
    ctx.lineWidth = Math.max(2, W / 600);
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
  }

  private async test(): Promise<void> {
    if (!this.frame || !this.rect || this.rect.w < 0.01) { this.out('Drag a box over the item list first.'); return; }
    this.out('Reading…');
    try {
      await this.host.ocr.load();
      const { w, h } = frameSize(this.frame);
      const rect = toRect(this.rect, w, h);
      const px = canvasAdapter.crop(this.frame, rect, listScale(rect.sw));
      const gray = listGray(px);
      const rows = parseLines(await this.host.ocr.recognize(canvasAdapter.toImage(px)), gray);
      this.out(rows.length
        ? rows.map((r) => `${r.greyed ? '[sold] ' : ''}${r.unsure ? '[check] ' : ''}${r.name}${r.truncated ? '…' : ''} · ${r.qty} for ${fmt(r.price)} mesos`).join('\n')
        : 'No "N for X mesos" lines found here. Make the box cover the item names and prices.');
    } catch (e) { this.out(`Read failed: ${(e as Error).message}`); }
  }

  private save(): void {
    const r = this.rect;
    if (!r || r.w < 0.01 || r.h < 0.01) { this.out(TEXT[this.kind].first); return; }
    this.host.save({ ...r }, this.kind);
    this.close();
  }
}
