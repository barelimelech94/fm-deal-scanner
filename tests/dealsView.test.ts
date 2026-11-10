// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShopSession } from '../src/shop/session';
import { DealsView, type DealsDeps } from '../src/ui/dealsView';
import { engine, NOW } from './helpers/market';

/** The page's own Deals view. */
const DEALS = readFileSync('index.html', 'utf8').match(/<section class="view two" id="view-deals"[\s\S]*?\n {2}<\/section>\n/)![0];

describe('DealsView', () => {
  let now = NOW;
  const e = engine({ now: () => now });
  const setup = (over: Partial<DealsDeps> = {}) => {
    const session = new ShopSession(e);
    const ran: string[] = [];
    const view = new DealsView({
      engine: e, session, failed: new Set(), saveSettings: () => {}, overlay: () => ran.push('overlay'), shown: () => true, version: () => '',
      capturing: () => false, looking: () => false,
      openPrices: () => ran.push('prices'), startCapture: () => ran.push('capture'), markShop: () => ran.push('mark'), ...over,
    });
    view.wire();
    return { session, view, ran };
  };
  const $ = (id: string) => document.getElementById(id)!;

  beforeEach(() => { document.body.innerHTML = DEALS; now = NOW; });

  it('redraws the overlay when the deals are cleared, as their banner shows there too', () => {
    const { session, ran } = setup();
    const v = session.version;
    $('btnClearDeals').click();
    expect(session.version).toBeGreaterThan(v);
    expect(ran).toEqual(['overlay']);
  });

  it('shows the Get started steps to someone new, and runs their buttons', () => {
    const { view, ran } = setup();
    view.render();
    expect($('dealsSetup').hidden).toBe(false);
    // the test market has prices: the first step is done
    expect([...$('dealsSteps').querySelectorAll('li')].map((li) => li.classList.contains('done'))).toEqual([true, false, false]);
    $('dealsSteps').querySelector<HTMLButtonElement>('button')!.click();
    expect(ran).toEqual(['capture']);
  });

  it('offers to mark the shop area after looking for one for a while, counting while not shown too', () => {
    let shown = false;
    const { view, ran } = setup({ looking: () => true, capturing: () => true, shown: () => shown });
    view.render();
    now += 16_000;
    shown = true;
    view.render(true);
    expect($('shopHelp').hidden).toBe(false);
    expect($('shopHelp').textContent).toBe('Not finding the shop? Mark its area');
    $('btnMarkShopHere').click();
    expect(ran).toEqual(['mark']);
  });
});
