import { describe, expect, it } from 'vitest';
import { appraise, appraiseEntry } from '../src/appraisal/appraise';
import { entryFor } from '../src/appraisal/entries';
import type { AppraisalEntry, TooltipRead } from '../src/lib/types';
import { appraisalRowHtml, appraisalRowsHtml, appraisalText } from '../src/ui/appraisalViews';
import { engine } from './helpers/market';

const e = engine();
const entry = (name: string, qty = 1, o: Partial<AppraisalEntry> = {}): AppraisalEntry => ({ ...entryFor(e, name, qty), id: `id-${name}`, ...o });
const row = (en: AppraisalEntry) => appraisalRowHtml(appraiseEntry(e, en, 'fair'), e.market);

describe('appraisalRowHtml', () => {
  it('shows the item, how many, the price each and the total', () => {
    const html = row(entry('Lemona', 1500));
    expect(html).toContain('class="ap-priced"');
    expect(html).toContain('<span class="nm-n">Lemona</span>');
    expect(html).toContain('data-field="qty" value="1,500"');
    expect(html).toContain('placeholder="21,000"');
    expect(html).toContain('<span class="sub">market</span>');
    expect(html).toContain('>31,500,000</td>');
    expect(html).toContain('<span class="chip priced"');
    expect(html).toContain('>Priced</span>');
    expect(html).toContain('<img src="https://maplestory.io/api/MCW/1/item/1082003/icon"');
  });

  it('asks for a price when there is none, and marks the item as unknown', () => {
    const html = row(entry('Mystery Thing', 3));
    expect(html).toContain('class="ap-unpriced"');
    expect(html).toContain('placeholder="price?"');
    expect(html).toContain('value=""');
    expect(html).toContain('not on the tracker');
    expect(html).toContain('>–</td>');
    expect(html).toContain('>No price</span>');
    expect(html).toContain('Type one in the Each box');
  });

  it('shows a typed price, and where the price comes from', () => {
    const html = row(entry('Unsold Cape', 4, { price: 500 }));
    expect(html).toContain('data-field="price" value="500"');
    expect(html).toContain('<span class="sub">typed here</span>');
    expect(html).toContain('>2,000</td>');
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

  it('builds a table body from every line', () => {
    const r = appraise(e, [entry('Lemona'), entry('Traus')], 'fair');
    expect(appraisalRowsHtml(r, e.market).match(/<tr /g)).toHaveLength(2);
    expect(appraisalRowsHtml(appraise(e, [], 'fair'), e.market)).toBe('');
  });
});

describe('appraisalText', () => {
  it('says there is nothing yet', () => {
    expect(appraisalText(appraise(e, [], 'fair'))).toMatchObject({ meta: 'Nothing added yet', total: '0', rough: '', warn: '', offerLabel: 'Offer at 100%', offer: '0' });
  });

  it('counts kinds and items, and what is skipped', () => {
    const r = appraise(e, [entry('Lemona', 2), entry('Traus'), entry('Bronze Chain Boots', 1, { ignored: true })], 'fair', 90);
    expect(appraisalText(r)).toMatchObject({ meta: '2 kinds, 3 items, 1 skipped', total: '97,000', offerLabel: 'Offer at 90%', offer: '87,300' });
    expect(appraisalText(appraise(e, [entry('Lemona')], 'fair')).meta).toBe('1 kind, 1 item');
  });

  it('warns about unpriced items and rough prices', () => {
    const r = appraise(e, [entry('Mystery Thing'), entry('Korean Fan'), entry('Lemona')], 'fair');
    expect(appraisalText(r).warn).toBe('1 item has no price and is not counted. Type a price in its Each box.');
    expect(appraisalText(r).rough).toBe('68,888 of it is a rough price');
    expect(appraisalText(appraise(e, [entry('Mystery Thing'), entry('Other Thing')], 'fair')).warn).toContain('2 items have no price and are not counted');
  });

  it('describes the mode in use', () => {
    expect(appraisalText(appraise(e, [], 'fair')).mode).toBe("Fair: the tracker's typical price.");
    expect(appraisalText(appraise(e, [], 'greedy')).mode).toContain('Greedy:');
  });
});
