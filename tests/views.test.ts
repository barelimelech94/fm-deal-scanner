import { describe, expect, it } from 'vitest';
import type { RawListing } from '../src/lib/types';
import { newItem } from '../src/pricing/priceBook';
import { ShopSession } from '../src/shop/session';
import {
  BEST_FIRST, bookRowHtml, bookRows, cleanSort, dealLine, hoverText, iconHtml, nextSort, overlayHtml, overlayRowHtml, parsePriceLines, rulesSummary, shopMeta, shopRowHtml, sortRows,
} from '../src/ui/views';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { catalogOf, engine, NOW } from './helpers/market';

const raw = (name: string, price: number, o: Partial<RawListing> = {}): RawListing => ({
  name, truncated: false, nameConf: 95, cy: null, qty: 1, price, greyed: false, unsure: false, ...o,
});

function shop(rows: RawListing[]) {
  const e = engine();
  const s = new ShopSession(e);
  s.read(rows, false);
  return { e, s, rows: sortRows(s.displayRows()) };
}

describe('icons', () => {
  const m = engine().market;
  const TRAUS = 'https://maplestory.io/api/MCW/1/item/1302012/icon';
  it('shows the picture with the emoji behind it', () => {
    expect(iconHtml(m, 'traus')).toBe(`<span class="ico" data-e="⚔️" aria-hidden="true"><img src="${TRAUS}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`);
  });
  it('shows only the emoji once the picture failed', () => {
    expect(iconHtml(m, 'traus', new Set([TRAUS]))).toBe('<span class="ico" data-e="⚔️" aria-hidden="true"></span>');
  });
  it('marks items the tracker does not know', () => {
    expect(iconHtml(m, 'mystery item')).toBe('<span class="ico unk" data-e="?" title="Not on the price tracker" aria-hidden="true"></span>');
  });
  it('still shows the picture of an item the tracker does not list, by its name in the game data', () => {
    const html = iconHtml(m.withCatalog(catalogOf([[1082002, 'Brown Work Gloves']])), 'brown work gloves');
    expect(html).toContain('class="ico unk"');
    expect(html).toContain('<img src="https://maplestory.io/api/MCW/1/item/1082002/icon"');
  });
  it('shows pictures with no tracker page loaded at all', () => {
    const e = engine({ items: [], book: { items: { lemona: newItem('Lemona') } } });
    e.market = e.market.withCatalog(catalogOf([[1082003, 'Lemona']]));
    const [row] = bookRows(e, '', { col: 'name', dir: 1 });
    expect(bookRowHtml(row!, NOW)).toContain('<img src="https://maplestory.io/api/MCW/1/item/1082003/icon"');
  });
});

describe('shop rows', () => {
  it('puts deals first', () => {
    const { rows } = shop([raw('Traus', 54000), raw('Dark Guardian', 40000), raw('Lemona', 30000)]);
    expect(rows.map((r) => [r.name, r.verdict])).toEqual([['Dark Guardian', 'deal'], ['Traus', 'fair'], ['Lemona', 'high']]);
  });
  it('describes a deal in words', () => {
    const { e, rows } = shop([raw('Dark Guardian', 40000)]);
    expect(dealLine(rows[0]!, e.market)).toEqual({
      name: 'Dark Guardian', listing: '1 for 40,000', why: 'usual 71,000 (market, 300 sales)', profit: '+28,870', profitNote: 'after fee',
    });
  });
  it('prices a stack per unit and a set of stars as one', () => {
    const { e, rows } = shop([raw('Arrows for Bows', 4000, { qty: 1000 }), raw('Wolbi Throwing Stars', 2999, { qty: 500 })]);
    const arrows = rows.find((r) => r.name === 'Arrows for Bows')!, stars = rows.find((r) => r.name === 'Wolbi Throwing Stars')!;
    expect(dealLine(arrows, e.market).listing).toBe('1000 for 4,000 (4 each)');
    expect(dealLine(stars, e.market).listing).toBe('set of 500 for 2,999');
    expect(shopRowHtml(stars, e.market)).toContain('title="One item holding 500, priced as a set"');
  });
  it('escapes names read off the screen', () => {
    const { e, rows } = shop([raw('<img src=x onerror=alert(1)>', 100)]);
    expect(shopRowHtml(rows[0]!, e.market)).not.toContain('<img src=x');
  });
  it('shows price now, usual price and the difference in the overlay', () => {
    const { e, rows } = shop([raw('Tobi Throwing Stars', 900000, { qty: 500 })]);
    const html = overlayRowHtml(rows[0]!, e.market);
    expect(html).toContain('<td class="n">900,000</td><td class="n dim">1.85M</td><td class="n pos">-51%</td>');
  });
  it('sums up the shop', () => {
    const { s, rows } = shop([raw('Dark Guardian', 40000), raw('Lemona', 30000), raw('Lemona', 30000)]);
    expect(shopMeta(s, rows)).toMatch(/^3 listings, 1 deal, opened /);
  });
});

describe('overlay', () => {
  it('shows a placeholder without a shop', () => {
    const e = engine();
    expect(overlayHtml({ open: false, capturing: true, rows: [], deal: null, hover: '', hoverKey: null }, e.market)).toContain('Open a shop in the game.');
  });
});

describe('hoverText', () => {
  it('says what the stats make the item worth', () => {
    const e = engine();
    const h = { key: 'traus', name: 'Traus', summary: '−2 att, 7 slots left', mult: 0.84, ts: NOW, rec: null };
    expect(hoverText(h, e)).toBe("Traus: −2 att, 7 slots left. Worth about 46,200 (usual 55,000). Not in this shop's list.");
    expect(hoverText({ ...h, ts: NOW - 120e3 }, e)).toBe('');
  });
});

describe('price book', () => {
  it('lists your items, and tracker items only when searched for', () => {
    const e = engine({ book: { items: { lemona: { ...newItem('Lemona'), manualRef: 25000 } } } });
    expect(bookRows(e, '', { col: 'name', dir: 1 }).map((r) => r.name)).toEqual(['Lemona']);
    expect(bookRows(e, 'scroll', { col: 'name', dir: 1 }).map((r) => r.name)).toEqual([
      'AP Reset Scroll', 'Gloves Attack Scroll: Chaos', 'Gloves Attack Scroll: Greater', 'Gloves Attack Scroll: Intermediate', 'SP Reset Scroll',
    ]);
    expect(bookRows(e, '', { col: 'usual', dir: -1 })[0]).toMatchObject({ usual: 25000, usualSrc: 'yours' });
  });
});

describe('parsePriceLines', () => {
  it('reads a name and a price per line', () => {
    expect(parsePriceLines('Cape INT Scroll: Lesser, 80k\nTobi Throwing Stars = 1.8m\nLemona 25,000 mesos\nnonsense\n')).toEqual({
      ok: [{ name: 'Cape INT Scroll: Lesser', value: 80000 }, { name: 'Tobi Throwing Stars', value: 1800000 }, { name: 'Lemona', value: 25000 }],
      bad: ['nonsense'],
    });
  });
});

describe('rulesSummary', () => {
  it('sums up the rules in a line', () => {
    expect(rulesSummary(DEFAULT_SETTINGS)).toBe('25% off, 3,000+ profit, 3% fee');
    expect(rulesSummary({ ...DEFAULT_SETTINGS, market: 'off', area: 'manual' })).toBe('25% off, 3,000+ profit, 3% fee, market prices off, marked area');
  });
});

describe('ordering the open shop', () => {
  // Axe Pole Arm: a deal (33% under, 4,550 profit). Dark Guardian: only 15% under, but 8,870 profit. Traus: 5% under, 1,350.
  const listings = () => [
    raw('Traus', 52000), raw('Axe Pole Arm', 10000), raw('Dark Guardian', 60000), raw('Mystery Thing', 5000), raw('Lemona', 20000, { greyed: true }),
  ];
  const order = (sort?: Parameters<typeof sortRows>[1]) => {
    const s = new ShopSession(engine());
    s.read(listings(), false);
    return sortRows(s.displayRows(), sort).map((r) => r.name);
  };

  it('puts deals first by default, whatever they make', () => {
    expect(order()).toEqual(['Axe Pole Arm', 'Dark Guardian', 'Traus', 'Mystery Thing', 'Lemona']);
    expect(order(BEST_FIRST)).toEqual(order());
  });

  it('puts the most profitable first, which is not always the biggest discount', () => {
    expect(order({ col: 'profit', dir: -1 })).toEqual(['Dark Guardian', 'Axe Pole Arm', 'Traus', 'Mystery Thing', 'Lemona']);
  });

  it('puts the least profitable first the other way, still leaving unpriced and sold rows last', () => {
    expect(order({ col: 'profit', dir: 1 })).toEqual(['Traus', 'Axe Pole Arm', 'Dark Guardian', 'Mystery Thing', 'Lemona']);
  });

  it('orders by price each, usual price, discount and name', () => {
    expect(order({ col: 'unit', dir: 1 })).toEqual(['Mystery Thing', 'Axe Pole Arm', 'Traus', 'Dark Guardian', 'Lemona']);
    expect(order({ col: 'usual', dir: -1 })).toEqual(['Dark Guardian', 'Traus', 'Axe Pole Arm', 'Mystery Thing', 'Lemona']);
    expect(order({ col: 'pct', dir: 1 })).toEqual(['Axe Pole Arm', 'Dark Guardian', 'Traus', 'Mystery Thing', 'Lemona']);
    expect(order({ col: 'name', dir: 1 })).toEqual(['Axe Pole Arm', 'Dark Guardian', 'Mystery Thing', 'Traus', 'Lemona']);
    expect(order({ col: 'name', dir: -1 })).toEqual(['Traus', 'Mystery Thing', 'Dark Guardian', 'Axe Pole Arm', 'Lemona']);
  });

  it('keeps sold rows last and rows with nothing to sort by last, whichever way a column runs', () => {
    for (const col of ['unit', 'usual', 'pct', 'profit', 'name'] as const) for (const dir of [1, -1] as const) {
      expect(order({ col, dir }).at(-1), `${col} ${dir}`).toBe('Lemona');
    }
    for (const dir of [1, -1] as const) expect(order({ col: 'profit', dir }).at(-2)).toBe('Mystery Thing');
  });

  it('falls back to deals first when two rows tie', () => {
    const s = new ShopSession(engine());
    s.read([raw('Traus', 52000), raw('Traus', 40000)], false);
    expect(sortRows(s.displayRows(), { col: 'name', dir: 1 }).map((r) => r.price)).toEqual([40000, 52000]);
  });

  it('sorts the same rows in place, like before', () => {
    const rows = shop(listings()).rows;
    expect(sortRows(rows)).toBe(rows);
  });
});

describe('choosing the shop order', () => {
  it('starts a column in its natural direction, and flips it on the next click', () => {
    expect(nextSort(BEST_FIRST, 'profit')).toEqual({ col: 'profit', dir: -1 });
    expect(nextSort({ col: 'profit', dir: -1 }, 'profit')).toEqual({ col: 'profit', dir: 1 });
    expect(nextSort({ col: 'profit', dir: 1 }, 'profit')).toEqual({ col: 'profit', dir: -1 });
    expect(nextSort({ col: 'profit', dir: -1 }, 'pct')).toEqual({ col: 'pct', dir: 1 });
    expect(nextSort(BEST_FIRST, 'unit')).toEqual({ col: 'unit', dir: 1 });
    expect(nextSort(BEST_FIRST, 'usual')).toEqual({ col: 'usual', dir: -1 });
    expect(nextSort(BEST_FIRST, 'name')).toEqual({ col: 'name', dir: 1 });
  });

  it('reads a saved choice, and takes the default for anything else', () => {
    expect(cleanSort('profit', -1)).toEqual({ col: 'profit', dir: -1 });
    expect(cleanSort('profit', 1)).toEqual({ col: 'profit', dir: 1 });
    expect(cleanSort('profit', 'down')).toEqual({ col: 'profit', dir: 1 });
    expect(cleanSort('nope', -1)).toEqual(BEST_FIRST);
    expect(cleanSort(undefined, undefined)).toEqual(BEST_FIRST);
  });

  it('is saved with the other settings', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ shopSort: 'best', shopSortDir: 1 });
  });
});
