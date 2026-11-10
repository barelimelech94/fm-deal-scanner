// What the Deals view offers someone new or stuck: its Get started steps, and the offer to mark the shop's area
// when none is found for a while. Pure, so it is tested without a browser.
import type { SetupStep } from './setupSteps';

/** What the Deals view's steps are worked out from: all of it state the page already has. */
export interface DealsSetupState {
  /** market prices loaded */
  prices: number;
  capturing: boolean;
  /** the price book has a sighting: a shop was read before */
  sighted: boolean;
  shopOpen: boolean;
}

/**
 * The Deals view's Get started steps. Capture counts as started once a shop was read, so someone who has used
 * the scanner (prices loaded, a shop read) never sees them again.
 */
export function dealsSteps(s: DealsSetupState, act: { openPrices(): void; startCapture(): void }): SetupStep[] {
  const shop = s.sighted || s.shopOpen;
  return [
    { label: 'Load market prices', done: s.prices > 0, action: { label: 'Go to Prices', run: act.openPrices } },
    { label: 'Start capture', done: s.capturing || shop, action: { label: 'Start capture', run: act.startCapture } },
    { label: 'Open a shop', done: shop },
  ];
}

/** How long capture looks for a shop before the view offers to mark its area. */
export const SHOP_SEARCH_MS = 15_000;

/**
 * Whether no shop has been found for a while: capture has been looking (running, in deals mode) for
 * `SHOP_SEARCH_MS` with no shop list found since it started, or since the last shop closed. `update` is told
 * what is going on each time the page hears of a change, and says whether to offer marking the area.
 */
export class ShopSearch {
  /** when the current look for a shop began; null while not looking, or while a shop is open */
  private since: number | null = null;

  update(s: { looking: boolean; shopOpen: boolean }, now: number): boolean {
    if (!s.looking || s.shopOpen) { this.since = null; return false; }
    this.since ??= now;
    return now - this.since >= SHOP_SEARCH_MS;
  }
}
