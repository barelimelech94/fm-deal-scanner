import { describe, expect, it } from 'vitest';
import { appraise } from '../src/appraisal/appraise';
import { entryFor } from '../src/appraisal/entries';
import type { RawListing } from '../src/lib/types';
import { ShopSession } from '../src/shop/session';
import { inventoryGlance } from '../src/ui/inventoryHtml';
import { overlayHtml, overlayRowHtml, type InventoryGlance, type OverlayState } from '../src/ui/overlayHtml';
import { sortRows } from '../src/ui/views';
import { engine } from './helpers/market';

const raw = (name: string, price: number, o: Partial<RawListing> = {}): RawListing => ({
  name, truncated: false, nameConf: 95, cy: null, qty: 1, price, greyed: false, unsure: false, ...o,
});
const e = engine();
const NOTHING: InventoryGlance = { last: null, worth: 0, items: 0, hint: '' };
const state: OverlayState = { mode: 'deals', open: false, capturing: true, scanning: false, rows: [], deal: null, hover: '', hoverKey: null, inventory: NOTHING };

describe('the overlay header', () => {
  it('is a two-way switch for the mode, with what capture is doing', () => {
    const deals = overlayHtml(state, e.market);
    expect(deals).toContain('<span class="modeswitch" role="group" aria-label="What to scan"><button data-act="mode-deals" aria-pressed="true">Deals</button><button data-act="mode-inventory" aria-pressed="false">Inventory</button></span><span>Watching</span>');
    const inv = overlayHtml({ ...state, mode: 'inventory', scanning: true }, e.market);
    expect(inv).toContain('<button data-act="mode-deals" aria-pressed="false">Deals</button><button data-act="mode-inventory" aria-pressed="true">Inventory</button></span><span>Scanning</span>');
    expect(overlayHtml({ ...state, capturing: false }, e.market)).toContain('<span>Not capturing</span>');
  });
});

describe('the overlay in deals mode', () => {
  it('shows a placeholder without a shop', () => {
    expect(overlayHtml(state, e.market)).toContain('<p class="empty">Open a shop in the game.</p>');
  });

  it('shows the newest deal as a banner, the hovered item, then the best eight rows', () => {
    const en = engine(), s = new ShopSession(en);
    s.read(Array.from({ length: 10 }, (_, i) => raw(i ? 'Lemona' : 'Dark Guardian', i ? 30000 + i : 40000)), false);
    const rows = sortRows(s.displayRows());
    const html = overlayHtml({ ...state, open: true, rows, deal: { ...rows[0]!, ts: 0 }, hover: 'Traus: 7 slots left.', hoverKey: 'traus' }, en.market);
    expect(html.indexOf('class="banner"')).toBeLessThan(html.indexOf('class="hovered"'));
    expect(html.indexOf('class="hovered"')).toBeLessThan(html.indexOf('<table'));
    expect(html).toContain('Dark Guardian');
    expect(html.match(/<tr class="v-/g)).toHaveLength(8);
    expect(html).not.toContain('data-act="scan"');
  });

  it('shows price now, usual price and the difference in a row', () => {
    const s = new ShopSession(e);
    s.read([raw('Tobi Throwing Stars', 900000, { qty: 500 })], false);
    expect(overlayRowHtml(sortRows(s.displayRows())[0]!, e.market)).toContain('<td class="n">900,000</td><td class="n dim">1.85M</td><td class="n pos">-51%</td>');
  });
});

describe('the overlay in inventory mode', () => {
  const lemona = { ...entryFor(e, 'Lemona'), id: 'a' }, scroll = { ...entryFor(e, 'Gloves Attack Scroll: Greater', 2), id: 'b' };
  const r = appraise(e, [lemona, scroll], 'fair');
  const glance = (lastId: string | null, storeAdjust = 5) => inventoryGlance(r, { lastId, storeAdjust, market: e.market, hint: '' });

  it('shows the item hovered last with its List at price large, its price and sales under it, then the worth', () => {
    expect(glance('a')).toEqual({ last: { key: 'lemona', name: 'Lemona', listAt: 22050, unit: 21000, priceLabel: 'Market', sales: 50 }, worth: 881000, items: 2, hint: '' });
    const html = overlayHtml({ ...state, mode: 'inventory', scanning: true, inventory: glance('a') }, e.market);
    expect(html).toContain('<span class="plast-n">Lemona</span><span class="plast-l"><small>List at</small>22,050</span><span class="sub">Market 21,000 · 50 sales</span>');
    expect(html).toContain('<div class="pworth"><span class="dim">Worth</span><b>881,000</b><span class="dim">2 items</span></div>');
    expect(html).toContain('<button class="btn" data-act="scan" aria-pressed="true">Pause</button>');
    // Scan first, then the item, then the worth
    expect(html.indexOf('data-act="scan"')).toBeLessThan(html.indexOf('plast'));
    expect(html.indexOf('plast')).toBeLessThan(html.indexOf('pworth'));
    expect(html).not.toContain('<table');
  });

  it('asks you to scan, or to point at an item, before anything was hovered', () => {
    expect(glance(null).last).toBeNull();
    expect(glance('gone').last).toBeNull();
    const paused = overlayHtml({ ...state, mode: 'inventory', inventory: glance(null) }, e.market);
    expect(paused).toContain('<button class="btn primary" data-act="scan" aria-pressed="false">Scan my items</button>');
    expect(paused).toContain('Press Scan my items, then point at your items in the game.');
    expect(overlayHtml({ ...state, mode: 'inventory', scanning: true, inventory: glance(null) }, e.market)).toContain('Point at an item in the game.');
  });

  it('says so for an item with no price, and escapes names', () => {
    const odd = { ...entryFor(e, '<b>Odd</b>'), id: 'c' };
    const g = inventoryGlance(appraise(e, [odd], 'greedy'), { lastId: 'c', storeAdjust: 0, market: e.market, hint: 'Added <b>Odd</b>' });
    const html = overlayHtml({ ...state, mode: 'inventory', inventory: g }, e.market);
    expect(html).toContain('<small>List at</small>no price</span><span class="sub"></span>');
    expect(html).not.toContain('<b>Odd</b>');
    expect(html).toContain('<p class="apnote">Added &lt;b&gt;Odd&lt;/b&gt;</p>');
  });
});
