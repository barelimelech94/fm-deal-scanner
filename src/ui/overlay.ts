import type { Engine } from '../engine';
import type { ScanMode } from '../lib/types';
import type { DisplayRow, ShopSession } from '../shop/session';
import { $ } from './dom';
import { overlayHtml, type InventoryGlance } from './overlayHtml';
import { setHtml } from './render';
import { freshDeal, hoverText } from './views';

export interface OverlayDeps {
  engine: Engine;
  session: ShopSession;
  /** icon addresses that failed to load */
  failed: ReadonlySet<string>;
  mode(): ScanMode;
  capturing(): boolean;
  /** scanning your items */
  scanning(): boolean;
  /** the open shop's rows, in the order the Deals view shows them */
  rows(): DisplayRow[];
  inventory(): InventoryGlance;
  /** the overlay's switch: sets the mode, and the page follows */
  setMode(mode: ScanMode): void;
  toggleScanning(): void;
  iconFailed(img: HTMLImageElement): void;
}

/**
 * A small always-on-top window (Document Picture-in-Picture, Chrome 116+) over the game. It follows the mode: in
 * deals, the newest deal, the hovered item and the best rows of the open shop; in inventory, the item hovered
 * last with its List at price, and the worth. A switch in its header changes the mode.
 */
export class Overlay {
  private win: Window | null = null;

  constructor(private readonly d: OverlayDeps) {}

  /** Opens the window, or says on the button that this browser can't. */
  async open(): Promise<void> {
    const pip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    if (!pip) { $('btnPip').textContent = 'Overlay needs Chrome 116+'; return; }
    let w: Window;
    try { w = await pip.requestWindow({ width: 380, height: 360 }); } catch (e) { console.warn(e); return; }
    // the page's styles, by absolute address: the overlay's own address is about:blank
    for (const n of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')) {
      const c = n.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
      if (c instanceof HTMLLinkElement) c.href = (n as HTMLLinkElement).href;
      w.document.head.appendChild(c);
    }
    const theme = document.documentElement.dataset.theme;
    if (theme) w.document.documentElement.dataset.theme = theme;
    w.document.title = 'FM Deal Scanner';
    w.document.body.className = 'pip';
    w.document.body.innerHTML = '<div id="pipRoot"></div>';
    w.document.addEventListener('error', (e) => { const t = e.target as Element | null; if (t?.tagName === 'IMG') this.d.iconFailed(t as HTMLImageElement); }, true);
    // buttons in the overlay carry data-act
    w.document.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'scan') this.d.toggleScanning();
      else if (act === 'mode-deals' || act === 'mode-inventory') this.d.setMode(act === 'mode-deals' ? 'deals' : 'inventory');
    });
    w.addEventListener('pagehide', () => { this.win = null; });
    this.win = w;
    this.render();
  }

  /** Draws the overlay, while it is open; only what differs from what it shows is written. */
  render(): void {
    const root = this.win?.document.getElementById('pipRoot');
    if (!root) return;
    const { session, engine } = this.d, h = session.hover;
    setHtml(root, overlayHtml({
      mode: this.d.mode(), open: session.open, capturing: this.d.capturing(), scanning: this.d.scanning(), rows: this.d.rows(),
      deal: freshDeal(session, engine.now()), hover: hoverText(h, engine), hoverKey: h?.key ?? null, inventory: this.d.inventory(),
    }, engine.market, this.d.failed));
  }
}
