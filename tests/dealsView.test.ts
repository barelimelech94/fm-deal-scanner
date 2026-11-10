// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ShopSession } from '../src/shop/session';
import { DealsView } from '../src/ui/dealsView';
import { engine } from './helpers/market';

describe('DealsView', () => {
  it('redraws the overlay when the deals are cleared, as their banner shows there too', () => {
    document.body.innerHTML = '<button id="btnClearDeals"></button><button id="shopSortReset"></button>';
    const e = engine(), session = new ShopSession(e);
    let overlays = 0;
    const view = new DealsView({
      engine: e, session, failed: new Set(), saveSettings: () => {}, overlay: () => { overlays++; }, shown: () => false, version: () => '',
    });
    view.wire();
    const v = session.version;
    document.querySelector<HTMLButtonElement>('#btnClearDeals')!.click();
    expect(session.version).toBeGreaterThan(v);
    expect(overlays).toBe(1);
  });
});
