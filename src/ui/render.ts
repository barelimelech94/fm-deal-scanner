// Drawing only what changed: a view's HTML is written only when it differs from what was written before, and
// a view works out its HTML only when the data it shows changed.

/** What each element was last given, as written: the browser's own innerHTML reads back differently. */
const written = new WeakMap<Element, string>();

/** Writes `html` into `el` only when it differs from what was written there last. Returns whether it wrote. */
export function setHtml(el: Element, html: string): boolean {
  if (written.get(el) === html) return false;
  el.innerHTML = html;
  written.set(el, html);
  return true;
}

/** Sets `el`'s text only when it differs. Returns whether it wrote. */
export function setText(el: Element, text: string): boolean {
  if (el.textContent === text) return false;
  el.textContent = text;
  return true;
}

/** Shows or hides `el`, touching it only when that changes. */
export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/**
 * Remembers which version of its data a view drew last, so it draws again only when that changed: `due(key)` is
 * true for a key other than the last one drawn, or when forced (the view was just shown, or the person changed it).
 */
export class DrawGate {
  private last: string | null = null;

  due(key: string, force = false): boolean {
    if (!force && key === this.last) return false;
    this.last = key;
    return true;
  }

  /** The last draw did not finish: the next `due` is true. */
  reset(): void { this.last = null; }
}
