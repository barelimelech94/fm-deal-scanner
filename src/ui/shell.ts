import type { ScanMode, Settings, ViewName } from '../lib/types';
import { $ } from './dom';

/** The views, in the order of their tabs. */
export const VIEWS: readonly ViewName[] = ['deals', 'inventory', 'prices', 'settings'];

/** The view an address names ("#prices"), if it names one. */
export const viewFromHash = (hash: string): ViewName | null => {
  const v = hash.replace(/^#/, '') as ViewName;
  return VIEWS.includes(v) ? v : null;
};

/** The tab a key moves to from tab `i` of `n`: the arrows step round, Home and End go to the ends. */
export function tabAfterKey(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight') return (i + 1) % n;
  if (key === 'ArrowLeft') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export interface ShellDeps {
  settings: Settings;
  /** store the settings: the view and the mode are among them */
  save(): void;
  /** opening Deals or Inventory sets the scan mode */
  setMode(mode: ScanMode): void;
  /** a view was shown */
  shown(view: ViewName): void;
}

/**
 * The bar's tabs and the views they show, one at a time. The address keeps the view (#deals, #inventory, #prices,
 * #settings) and the last one is remembered. Opening Deals or Inventory sets the scan mode; Prices and Settings
 * leave it alone.
 */
export class Shell {
  private current: ViewName;

  constructor(private readonly d: ShellDeps) {
    this.current = d.settings.view;
  }

  get view(): ViewName { return this.current; }
  isShown(v: ViewName): boolean { return this.current === v; }

  private tab(v: ViewName): HTMLElement { return $(`tab-${v}`); }

  /** Wires the tabs and the address, and shows the view the address names, else the one shown last. */
  start(): void {
    VIEWS.forEach((v, i) => {
      const tab = this.tab(v);
      tab.addEventListener('click', () => this.show(v));
      tab.addEventListener('keydown', (e) => {
        const to = tabAfterKey(e.key, i, VIEWS.length);
        if (to == null) return;
        e.preventDefault();
        this.show(VIEWS[to]!, true);
      });
    });
    window.addEventListener('hashchange', () => { const v = viewFromHash(location.hash); if (v) this.show(v); });
    this.show(viewFromHash(location.hash) ?? this.d.settings.view);
  }

  /**
   * The mode was chosen elsewhere (the overlay's switch): the page follows, opening the matching view when it shows
   * Deals or Inventory. Prices and Settings stay put.
   */
  followMode(mode: ScanMode): void {
    if (this.current === 'deals' || this.current === 'inventory') { this.show(mode); return; }
    this.d.setMode(mode);
    this.d.save();
  }

  show(v: ViewName, focus = false): void {
    this.current = v;
    for (const x of VIEWS) {
      const on = x === v, tab = this.tab(x);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`view-${x}`).hidden = !on;
    }
    if (focus) this.tab(v).focus();
    if (location.hash !== `#${v}`) history.replaceState(null, '', `#${v}`);
    this.d.settings.view = v;
    if (v === 'deals' || v === 'inventory') this.d.setMode(v);
    this.d.save();
    this.d.shown(v);
  }
}
