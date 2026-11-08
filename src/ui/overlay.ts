/**
 * A small always-on-top window (Document Picture-in-Picture, Chrome 116+) that shows the open
 * shop over the game.
 */
export class Overlay {
  win: Window | null = null;

  static supported(): boolean { return 'documentPictureInPicture' in window; }

  async open(onIconError: (img: HTMLImageElement) => void, onAction: (act: string) => void = () => {}): Promise<Window | null> {
    const pip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    if (!pip) return null;
    const w = await pip.requestWindow({ width: 380, height: 360 });
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
    w.document.addEventListener('error', (e) => { const t = e.target as Element | null; if (t?.tagName === 'IMG') onIconError(t as HTMLImageElement); }, true);
    // buttons in the overlay carry data-act; the page handles them
    w.document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act) onAction(b.dataset.act);
    });
    w.addEventListener('pagehide', () => { this.win = null; });
    this.win = w;
    return w;
  }

  render(html: string): void {
    const root = this.win?.document.getElementById('pipRoot');
    if (root) root.innerHTML = html;
  }
}
