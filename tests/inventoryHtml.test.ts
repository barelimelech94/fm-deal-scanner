import { describe, expect, it } from 'vitest';
import { appraise, appraiseEntry } from '../src/appraisal/appraise';
import { entryFor } from '../src/appraisal/entries';
import type { AppraisalEntry, TooltipRead } from '../src/lib/types';
import {
  inventoryMeta, inventoryRowHtml, inventoryRowsHtml, inventorySteps, inventoryTotals, offerAsk, shownLines,
} from '../src/ui/inventoryHtml';
import { engine } from './helpers/market';

const e = engine();
const entry = (name: string, qty = 1, o: Partial<AppraisalEntry> = {}): AppraisalEntry => ({ ...entryFor(e, name, qty), id: `id-${name}`, ...o });
const row = (en: AppraisalEntry, storeAdjust = 0, last = false) => inventoryRowHtml(appraiseEntry(e, en, 'fair'), e.market, { storeAdjust, last });

describe('inventoryRowHtml', () => {
  it('shows the item, the count, the price each, the worth and the List at price, in that order', () => {
    const html = row(entry('Gloves Attack Scroll: Greater', 1500), 5);
    expect(html).toContain('class="ap-priced"');
    expect(html).toContain('<span class="nm-n">Gloves Attack Scroll: Greater</span>');
    const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    expect(cells[1]).toContain('data-field="qty" value="1,500"');
    expect(cells[2]).toBe('430,000<span class="sub">market</span>');
    expect(cells[3]).toBe('645,000,000');
    expect(cells[4]).toContain('data-field="price" value="451,500"');
    expect(cells[5]).toContain('>Priced</span>');
    expect(html).toContain('<img src="https://maplestory.io/api/MCW/1/item/2040802/icon"');
  });

  it('moves the List at price with the percent, and shows a price typed there as it is', () => {
    expect(row(entry('Lemona'), -10)).toContain('data-field="price" value="18,900"');
    const typed = row(entry('Lemona', 1, { price: 25000 }), 5);
    expect(typed).toContain('data-field="price" value="25,000"');
    expect(typed).toContain('<span class="sub">typed here</span>');
  });

  it('asks for a price when there is none, and marks the item as unknown', () => {
    const html = row(entry('Mystery Thing', 3));
    expect(html).toContain('class="ap-unpriced"');
    expect(html).toContain('data-field="price" value="" placeholder="price?"');
    expect(html).toContain('not on the tracker');
    expect(html).toContain('>No price</span>');
    expect(html).toContain('Type one in its List at box');
  });

  it('asks for the count of a stack still at 1, and not of an equip', () => {
    const potion = row(entry('Gloves Attack Scroll: Greater'));
    expect(potion).toContain('cellinput qty need');
    expect(potion).toContain('>Type count</span>');
    expect(potion).not.toContain('>Priced</span>');
    const lemona = row(entry('Lemona'));
    expect(lemona).not.toContain(' need"');
    expect(lemona).toContain('>Priced</span>');
    expect(row(entry('Gloves Attack Scroll: Greater', 1, { counted: true }))).not.toContain('Type count');
  });

  it('highlights the line hovered last', () => {
    expect(row(entry('Lemona'), 0, true)).toContain('class="ap-priced last"');
    expect(row(entry('Lemona'))).toContain('class="ap-priced"');
  });

  it('flags a rough price with the reason', () => {
    const html = row(entry('Korean Fan'));
    expect(html).toContain('class="ap-rough"');
    expect(html).toContain('>Rough</span>');
    expect(html).toContain('copies sell for very different prices');
  });

  it('says so for sets, and for hovered stats', () => {
    expect(row(entry('Wolbi Throwing Stars', 2))).toContain('priced per set');
    expect(row(entry('Wolbi Throwing Stars', 2))).toContain('aria-label="Sets of Wolbi Throwing Stars"');
    const tip: TooltipRead = { key: 'traus', name: 'Traus', type: 'One-handed Sword', remaining: 7, stats: [{ label: 'att', weight: 1, total: 58, base: 60, delta: -2 }] };
    expect(row(entry('Traus', 1, { tip }))).toContain('−2 att, 7 slots left');
  });

  it('offers to skip a line, or to count it again, and to remove it', () => {
    const open = row(entry('Lemona'));
    expect(open).toContain('data-act="skip" aria-pressed="false" aria-label="Skip Lemona"');
    expect(open).toContain('data-act="del"');
    const skipped = row(entry('Lemona', 1, { ignored: true }));
    expect(skipped).toContain('class="ap-ignored"');
    expect(skipped).toContain('data-act="skip" aria-pressed="true" aria-label="Count Lemona"');
    expect(skipped).toContain('>Skipped</span>');
  });

  it('escapes what it was given', () => {
    const html = row(entry('<img src=x onerror=alert(1)>', 1));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('builds a table body from the lines shown, the last hovered one marked', () => {
    const r = appraise(e, [entry('Lemona'), entry('Traus')], 'fair');
    const html = inventoryRowsHtml(r.lines, e.market, { storeAdjust: 0, lastId: 'id-Traus' });
    expect(html.match(/<tr /g)).toHaveLength(2);
    expect(html.match(/ last"/g)).toHaveLength(1);
    expect(inventoryRowsHtml([], e.market, { storeAdjust: 0, lastId: null })).toBe('');
  });
});

describe('the need-a-count filter', () => {
  const r = appraise(e, [
    entry('Lemona'), entry('Gloves Attack Scroll: Greater'), entry('Wolbi Throwing Stars', 4), entry('Mystery Thing'),
    entry('Gloves Attack Scroll: Intermediate', 1, { counted: true }), entry('Gloves Attack Scroll: Chaos', 1, { ignored: true }),
  ], 'fair');

  it('shows only the stacks whose count is still 1, in the order they were added', () => {
    expect(shownLines(r, true).map((l) => l.name)).toEqual(['Gloves Attack Scroll: Greater', 'Mystery Thing']);
    expect(shownLines(r, false)).toHaveLength(6);
  });

  it('is offered in the head with how many there are', () => {
    expect(inventoryMeta(r)).toEqual({ items: '5 items', need: '2 need a count', noPrice: '1 has no price' });
    expect(inventoryMeta(appraise(e, [entry('Mystery Thing')], 'fair'))).toEqual({ items: '1 item', need: '1 needs a count', noPrice: '1 has no price' });
    expect(inventoryMeta(appraise(e, [entry('Lemona')], 'fair')).need).toBeNull();
    expect(inventoryMeta(appraise(e, [], 'fair'))).toEqual({ items: 'No items yet', need: null, noPrice: '' });
  });
});

describe('inventoryTotals', () => {
  it('gives the worth and what the store asks', () => {
    const r = appraise(e, [entry('Lemona', 2), entry('Gloves Attack Scroll: Greater')], 'fair');
    expect(inventoryTotals(r, 0)).toEqual({ worth: '472,000', store: '472,000', left: '' });
    expect(inventoryTotals(r, 5)).toEqual({ worth: '472,000', store: '495,600', left: '' });
    expect(inventoryTotals(appraise(e, [], 'fair'), 5)).toEqual({ worth: '0', store: '0', left: '' });
  });

  it('says what is left out, and how many prices are rough', () => {
    const r = appraise(e, [entry('Mystery Thing'), entry('Other Thing'), entry('Korean Fan'), entry('Lemona', 1, { ignored: true })], 'fair');
    expect(inventoryTotals(r, 0).left).toBe('2 items not counted: no price · 1 skipped · 1 price is rough');
    expect(inventoryTotals(appraise(e, [entry('Mystery Thing')], 'fair'), 0).left).toBe('1 item not counted: no price');
  });
});

describe('the offer for everything', () => {
  it('is the worth at the offer percent', () => {
    expect(offerAsk(appraise(e, [entry('Lemona', 2), entry('Traus')], 'fair', 90))).toBe("You'd ask 87,300");
  });
});

describe('the Inventory Get started steps', () => {
  const act = { openPrices() {}, startCapture() {} };
  const done = (s: Parameters<typeof inventorySteps>[0]) => inventorySteps(s, act).map((x) => x.done);

  it('are the three steps, ticked off as they are done', () => {
    const steps = inventorySteps({ prices: 0, capturing: false, items: 0 }, act);
    expect(steps.map((x) => x.label)).toEqual(['Load market prices', 'Start capture', 'Press Scan my items and point at your items']);
    expect(steps.map((x) => x.action?.label ?? null)).toEqual(['Go to Prices', 'Start capture', null]);
    expect(done({ prices: 0, capturing: false, items: 0 })).toEqual([false, false, false]);
    expect(done({ prices: 7, capturing: true, items: 0 })).toEqual([true, true, false]);
  });

  it('count capture as started once you have an item', () => {
    expect(done({ prices: 7, capturing: false, items: 2 })).toEqual([true, true, true]);
  });
});
