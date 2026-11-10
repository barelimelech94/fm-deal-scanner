// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { dealsSteps, SHOP_SEARCH_MS, ShopSearch, type DealsSetupState } from '../src/ui/dealsHelp';
import { allStepsDone, setupStepsHtml, SetupSteps, type SetupStep } from '../src/ui/setupSteps';

describe('Get started steps', () => {
  const steps = (ran: string[] = []): SetupStep[] => [
    { label: 'Load market prices', done: true, action: { label: 'Go to Prices', run: () => ran.push('prices') } },
    { label: 'Start capture', done: false, action: { label: 'Start capture', run: () => ran.push('capture') } },
    { label: 'Open a <shop>', done: false },
  ];

  it('numbers the steps, ticks the done ones, and offers a button only for a step still to do', () => {
    const html = setupStepsHtml(steps());
    document.body.innerHTML = html;
    const li = [...document.querySelectorAll('li')];
    expect(li.map((l) => l.querySelector('.n')!.textContent)).toEqual(['1', '2', '3']);
    expect(li.map((l) => l.classList.contains('done'))).toEqual([true, false, false]);
    expect(li[0]!.querySelector('.mark')!.textContent).toBe('✓');
    expect(li[0]!.textContent).toContain('Load market prices (done)');
    expect(li[0]!.querySelector('button')).toBeNull();
    expect(li[1]!.querySelector('button')!.textContent).toBe('Start capture');
    expect(li[1]!.querySelector('button')!.dataset.step).toBe('1');
    expect(li[2]!.querySelector('button')).toBeNull();
    expect(html).toContain('Open a &lt;shop&gt;');
    expect(document.querySelector('ol')!.getAttribute('role')).toBe('list');
  });

  it('is done when every step is', () => {
    expect(allStepsDone(steps())).toBe(false);
    expect(allStepsDone(steps().map((s) => ({ ...s, done: true })))).toBe(true);
  });

  it('runs a step’s action from its button, and hides the card once all are done', () => {
    document.body.innerHTML = '<section id="card"><div id="list"></div></section>';
    const card = document.getElementById('card')!, ran: string[] = [];
    const view = new SetupSteps(card, document.getElementById('list')!);
    view.render(steps(ran));
    expect(card.hidden).toBe(false);
    card.querySelector<HTMLButtonElement>('[data-step="1"]')!.click();
    expect(ran).toEqual(['capture']);
    view.render(steps().map((s) => ({ ...s, done: true })));
    expect(card.hidden).toBe(true);
  });
});

describe("the Deals view's steps", () => {
  const act = { openPrices: () => {}, startCapture: () => {} };
  const done = (s: Partial<DealsSetupState>) =>
    dealsSteps({ prices: 0, capturing: false, sighted: false, shopOpen: false, ...s }, act).map((x) => x.done);

  it('are load prices, start capture, open a shop', () => {
    expect(dealsSteps({ prices: 0, capturing: false, sighted: false, shopOpen: false }, act).map((s) => s.label))
      .toEqual(['Load market prices', 'Start capture', 'Open a shop']);
    expect(done({})).toEqual([false, false, false]);
  });

  it('tick off from the state the page has', () => {
    expect(done({ prices: 7 })).toEqual([true, false, false]);
    expect(done({ capturing: true })).toEqual([false, true, false]);
    expect(done({ shopOpen: true })).toEqual([false, true, true]);
  });

  it('count a shop read before as done, capture too, so someone who has used the scanner never sees them', () => {
    expect(done({ prices: 7, sighted: true })).toEqual([true, true, true]);
  });

  it('open the Prices view and start capture from their buttons', () => {
    const ran: string[] = [];
    const s = dealsSteps({ prices: 0, capturing: false, sighted: false, shopOpen: false }, { openPrices: () => ran.push('prices'), startCapture: () => ran.push('capture') });
    s[0]!.action!.run();
    s[1]!.action!.run();
    expect(ran).toEqual(['prices', 'capture']);
    expect(s[2]!.action).toBeUndefined();
  });
});

describe('no shop found for a while', () => {
  const T = 1_000_000;

  it('is after 15 seconds of looking with no shop', () => {
    const w = new ShopSearch();
    expect(w.update({ looking: true, shopOpen: false }, T)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + SHOP_SEARCH_MS - 1)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + SHOP_SEARCH_MS)).toBe(true);
  });

  it('goes as soon as a shop is found, and counts again from when it closed', () => {
    const w = new ShopSearch();
    w.update({ looking: true, shopOpen: false }, T);
    expect(w.update({ looking: true, shopOpen: true }, T + 20_000)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + 30_000)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + 44_000)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + 45_000)).toBe(true);
  });

  it('is never while not looking (capture off, or scanning your items), and counts afresh after', () => {
    const w = new ShopSearch();
    w.update({ looking: true, shopOpen: false }, T);
    expect(w.update({ looking: false, shopOpen: false }, T + 20_000)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + 21_000)).toBe(false);
    expect(w.update({ looking: true, shopOpen: false }, T + 36_000)).toBe(true);
  });
});
