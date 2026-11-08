import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { loadPng, placeOn, scaleBy } from '../tests/helpers/image';
import type { Pixels } from '../src/vision/pixels';
import { HOVER_ITEMS } from '../tests/helpers/hover';

/** A screen-sized PNG with a fixture drawn on it, as a file for the screenshot picker. */
function screenFile(name: string, frame: Pixels) {
  const png = new PNG({ width: frame.width, height: frame.height });
  png.data = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}

function hoverOverShop(f: number, sw: number, sh: number): Pixels {
  const tip = scaleBy(loadPng('tooltip-traus.png'), f);
  const frame = placeOn(scaleBy(loadPng('shop-list.png'), f), sw, sh, 100, 100);
  const at = { x: Math.round(100 + 300 * f), y: Math.round(100 + 120 * f) };
  for (let y = 0; y < tip.height && at.y + y < sh; y++) for (let x = 0; x < tip.width && at.x + x < sw; x++) {
    const s = (y * tip.width + x) * 4, o = ((at.y + y) * sw + at.x + x) * 4;
    frame.data[o] = tip.data[s]!; frame.data[o + 1] = tip.data[s + 1]!; frame.data[o + 2] = tip.data[s + 2]!;
  }
  return frame;
}

/** A saved tracker page, made up: the parts of the table the importer reads. */
type TrackerRow = [id: string, name: string, category: string, price: number, sales: number, emoji: string, npcShopPrice?: number];
const trackerPage = (rows: TrackerRow[]) => `<!doctype html><html><body><div id="world"><span>Windia</span></div>
<button id="updated" title="Last updated Nov 4, 9:00 AM"></button><table><tbody id="rows">
${rows.map(([id, n, c, p, s, e, npc]) => `<tr data-id="basil:${id}"><td><img data-fallback="${e}"><span class="item-name" title="${n}">${n}</span><span class="item-cat">${c}</span></td>
<td data-col="price"><span class="meso" title="${Number(p).toLocaleString('en-US')} mesos">x</span></td><td><span class="sales-count">${s}</span></td>${npc ? `<td data-col="from"><span class="src-chips"><span class="src-chip src-shop" data-src-tip="NPC shop|Test NPC (Henesys) · ${npc.toLocaleString('en-US')} mesos each"></span></span></td>` : ''}</tr>`).join('\n')}
</tbody></table></body></html>`;

const TRACKER = trackerPage([
  ['01472013', 'Dark Guardian', 'Weapons', 120000, 300, '🗡️'],
  ['01072044', 'Bronze Chain Boots', 'Equips', 12000, 60, '👢'],
  ['01082003', 'Lemona', 'Equips', 21000, 50, '🧤'],
  ['02041019', 'Cape INT Scroll: Lesser', 'Scrolls', 65000, 955, '📜'],
  ['02040703', 'Shoes Speed Scroll: Chaos', 'Scrolls', 21000, 120, '📜'],
  ['01302012', 'Traus', 'Weapons', 55000, 94, '⚔️'],
  ['02070006', 'Wolbi Throwing Stars', 'Stars', 2499, 7359, '⭐'],
]);

/** The items on the hover screenshots, as the tracker had them on Nov 7 2026. */
const HOVER_TRACKER = trackerPage(HOVER_ITEMS.map((it, i): TrackerRow => [`0${1000000 + i}`, it.n, it.c, it.p ?? 0, it.s, '📦']));

/** The item names the build fetches from maplestory.io, a few of them, so the tests don't depend on it. */
const CATALOG = { source: 'test', fetched: '2026-11-04T00:00:00Z', items: [[1082003, 'Lemona'], [1302012, 'Traus']] };

/** Icons come from maplestory.io; the tests serve a stand-in so they don't depend on it. */
const ICON = PNG.sync.write(Object.assign(new PNG({ width: 4, height: 4 }), { data: Buffer.alloc(64, 200) }));

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const icons: string[] = [];
  await page.route('https://maplestory.io/**', (r) => { icons.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'image/png', body: ICON }); });
  await page.route('**/fm-deal-scanner/items.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { errors, icons };
}

async function loadShot(page: Page, file: ReturnType<typeof screenFile>) {
  const before = Number(await page.evaluate(() => document.body.dataset.scans ?? 0));
  await page.setInputFiles('#fileShot', file);
  await page.waitForFunction((n) => Number(document.body.dataset.scans ?? 0) > n, before, { timeout: 90_000 });
}

const shopNames = (page: Page) => page.locator('#shopTable tbody .nm-n').allTextContents();

test('loads with no errors and serves the reader from the site', async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator('#statusText')).toContainText('Not capturing');
  const ocr = await page.request.get('ocr/lang/eng.traineddata.gz');
  expect(ocr.ok()).toBe(true);
  expect(errors).toEqual([]);
});

test('reads a shop from a screenshot and flags the deal', async ({ page }) => {
  const { errors, icons } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await expect(page.locator('#marketMsg')).toContainText('Loaded 7 market prices for Windia');

  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  const names = await shopNames(page);
  expect(names.map((n) => n.trim()).sort()).toEqual([
    'Bronze Chain Boots', 'Bronze Chain Boots', 'Cape INT Scroll: Lesser', 'Dark Guardian', 'Lemona', 'Shoes Speed Scroll: Chaos',
  ]);
  await expect(page.locator('#statusText')).toContainText('Shop open, 6 listings');
  // Dark Guardian usually 120,000: 79,999 is a third off
  await expect(page.locator('#dealBanner')).toBeVisible();
  await expect(page.locator('#dealWhat')).toContainText('Dark Guardian');
  await expect(page.locator('#dealList li')).toHaveCount(1);
  const deal = page.locator('#shopTable tbody tr.v-deal');
  await expect(deal).toHaveCount(1);
  await expect(deal.locator('.chip')).toHaveText('Deal');
  // item pictures by item id, from Classic World's data
  await expect.poll(() => icons).toContain('https://maplestory.io/api/MCW/1/item/1472013/icon');
  // the sighting is in the price book
  await expect(page.locator('#bookTable tbody')).toContainText('Dark Guardian');
  expect(errors).toEqual([]);
});

test('reads the stats off a hover tooltip', async ({ page }) => {
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await loadShot(page, screenFile('hover.png', hoverOverShop(1, 2560, 1600)));
  const hover = page.locator('#hoverLine');
  await expect(hover).toBeVisible();
  await expect(hover).toContainText('Traus: −2 att, 7 slots left');
  await expect(hover).toContainText('Worth about 46,200 (usual 55,000)');
  expect(errors).toEqual([]);
});

test('keeps your data from the single-file scanner', async ({ page }) => {
  const { icons } = await open(page);
  const backup = {
    version: 1, exported: '2026-11-03T10:00:00.000Z',
    db: { items: { lemona: { name: 'Lemona', manualRef: 25000, buyUnder: 15000, s: [[Date.now() - 3600e3, 19999, 1]] } } },
    settings: {}, region: null,
  };
  await page.setInputFiles('#fileImport', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#dataMsg')).toHaveText('Imported 1 item.');
  const row = page.locator('#bookTable tbody tr', { hasText: 'Lemona' });
  await expect(row.locator('input[data-field="manualRef"]')).toHaveValue('25,000');
  await expect(row.locator('input[data-field="buyUnder"]')).toHaveValue('15,000');
  // its picture shows with no tracker page loaded, found by name in the game data
  await expect(row.locator('.ico img')).toHaveAttribute('src', 'https://maplestory.io/api/MCW/1/item/1082003/icon');
  await expect.poll(() => icons).toContain('https://maplestory.io/api/MCW/1/item/1082003/icon');
  // and it is still there after a reload
  await page.reload();
  await expect(page.locator('#bookTable tbody tr', { hasText: 'Lemona' })).toHaveCount(1);
});

test('appraises a pile of items typed in, and keeps it', async ({ page }) => {
  const { errors } = await open(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await expect(page.locator('#marketMsg')).toContainText('Loaded 7 market prices');
  await expect(page.locator('#apMeta')).toHaveText('Nothing added yet');
  await expect(page.locator('#apEmpty')).toBeVisible();

  await page.fill('#apAdd', 'Cape INT Scroll: Lesser x3\nShoes Speed Scroll: Chaos x5\nLemona\nWolbi Throwing Stars x2\nMystery Thing x4');
  await page.click('#apAddBtn');
  await expect(page.locator('#apBody tr')).toHaveCount(5);
  await expect(page.locator('#apMsg')).toHaveText('Added 5 items.');
  // 3 × 65,000 + 5 × 21,000 + 21,000 + 2 sets × 2,499; the unknown item has no price
  await expect(page.locator('#apTotal')).toHaveText('325,998');
  await expect(page.locator('#apMeta')).toHaveText('5 kinds, 15 items');
  await expect(page.locator('#apWarn')).toContainText('1 item has no price');
  await expect(page.locator('#apQuote')).toHaveText('5 kinds / 15 items = 325,998 mesos (1 not priced)');
  await expect(page.locator('#apBody tr', { hasText: 'Wolbi' })).toContainText('priced per set');

  // type a price for the unknown item: it counts, and the warning goes
  const mystery = page.locator('#apBody tr', { hasText: 'Mystery Thing' });
  await mystery.locator('input[data-field="price"]').fill('1k');
  await mystery.locator('input[data-field="price"]').press('Tab');
  await expect(page.locator('#apTotal')).toHaveText('329,998');
  await expect(page.locator('#apWarn')).toBeHidden();
  await expect(page.locator('#apBody tr', { hasText: 'Mystery Thing' }).locator('.chip')).toHaveText('Priced');

  // offer 90% of everything
  await page.fill('#apBulk', '90');
  await page.press('#apBulk', 'Tab');
  await expect(page.locator('#apOffer')).toHaveText('296,998');
  await expect(page.locator('#apOfferLabel')).toHaveText('Offer at 90%');
  await expect(page.locator('#apQuote')).toHaveText('5 kinds / 15 items = 296,998 mesos');
  await page.click('#apCopy');
  await expect(page.locator('#apMsg')).toHaveText('Copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('5 kinds / 15 items = 296,998 mesos');

  // a skipped line is left out of the total; greedy reads the same without sightings
  await page.locator('#apBody tr', { hasText: 'Lemona' }).locator('button[data-act="skip"]').click();
  await expect(page.locator('#apTotal')).toHaveText('308,998');
  await expect(page.locator('#apMeta')).toHaveText('4 kinds, 14 items, 1 skipped');
  await page.selectOption('#apMode', 'greedy');
  await expect(page.locator('#apModeNote')).toContainText('Greedy');
  await expect(page.locator('#apTotal')).toHaveText('308,998');

  // all of it is still there after a reload
  await page.reload();
  await expect(page.locator('#apBody tr')).toHaveCount(5);
  await expect(page.locator('#apTotal')).toHaveText('308,998');
  await expect(page.locator('#apMode')).toHaveValue('greedy');
  await expect(page.locator('#apBulk')).toHaveValue('90');
  await expect(page.locator('#apBody tr', { hasText: 'Lemona' }).locator('.chip')).toHaveText('Skipped');

  // remove one line, then clear the rest (a second click confirms)
  await page.locator('#apBody tr', { hasText: 'Mystery Thing' }).locator('button[data-act="del"]').click();
  await expect(page.locator('#apBody tr')).toHaveCount(4);
  await page.click('#apClear');
  await expect(page.locator('#apBody tr')).toHaveCount(4);
  await page.click('#apClear');
  await expect(page.locator('#apBody tr')).toHaveCount(0);
  await expect(page.locator('#apMeta')).toHaveText('Nothing added yet');
  await expect(page.locator('#apEmpty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('adds the items you hover to the appraisal, and only while scanning', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(HOVER_TRACKER) });
  await expect(page.locator('#marketMsg')).toContainText('Loaded 10 market prices');
  const screen = (name: string) => screenFile(`${name}.png`, placeOn(loadPng(`appraisal/${name}.png`), 1440, 900, 100, 100));
  const rows = page.locator('#apBody tr');

  // nothing to scan yet: scanning can't start
  await page.click('#apScan');
  await expect(page.locator('#apHint')).toContainText('Start the screen capture first');
  await expect(page.locator('#apState')).toHaveText('Paused');

  // a screenshot to scan, then start: the scroll under the mouse is added, with its count flagged for typing
  await loadShot(page, screen('use-scroll-inventory'));
  await page.click('#apScan');
  await expect(page.locator('#apState')).toHaveText('Scanning: point at your items');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Overall Armor LUK Scroll: Greater');
  await expect(rows.first().locator('.cellinput.unsure')).toHaveCount(1);
  await expect(page.locator('#apHint')).toContainText('type how many you have');
  await expect(page.locator('#statusText')).toContainText('Scanning hovers');

  // another item, in the trade window: an equip, with its stats
  await loadShot(page, screen('trade-equip'));
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Lemona');
  await expect(rows.nth(1).locator('.cellinput.unsure')).toHaveCount(0);
  await expect(page.locator('#apTotal')).toHaveText('29,499');   // 27,499 + 2,000

  // a hover that is a repeat adds nothing
  await loadShot(page, screen('trade-equip'));
  await expect(rows).toHaveCount(2);

  // type the count of the scroll: no longer in doubt
  await rows.first().locator('input[data-field="qty"]').fill('3');
  await rows.first().locator('input[data-field="qty"]').press('Tab');
  await expect(rows.first().locator('.cellinput.unsure')).toHaveCount(0);
  await expect(page.locator('#apTotal')).toHaveText('84,497');   // 3 × 27,499 + 2,000

  // a potion, then take it back
  await loadShot(page, screen('bright-potion-count'));
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#apUndo')).toBeEnabled();
  await page.click('#apUndo');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#apHint')).toContainText('Took back Red Potion');

  // paused: hovering adds nothing
  await page.click('#apScan');
  await expect(page.locator('#apState')).toHaveText('Paused');
  await loadShot(page, screen('equip-not-worn'));
  await expect(rows).toHaveCount(2);

  // with an area marked far from the tooltip, hovering adds nothing either
  await page.click('#apMark');
  await expect(page.locator('#calib')).toBeVisible();
  await expect(page.locator('#hCalib')).toHaveText('Mark the area of items');
  const box = (await page.locator('#calibCanvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.03);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.13, { steps: 5 });
  await page.mouse.up();
  await page.click('#calibSave');
  await expect(page.locator('#calib')).toBeHidden();
  await expect(page.locator('#apArea')).toHaveValue('marked');
  await page.click('#apScan');
  await expect(page.locator('#apState')).toHaveText('Scanning: point at your items');
  await expect(rows).toHaveCount(2);   // the screenshot on screen has its tooltip far from the box
  await loadShot(page, screen('equip-not-worn'));
  await expect(rows).toHaveCount(2);
  // back to anywhere: it is counted
  await page.selectOption('#apArea', 'any');
  await loadShot(page, screen('equip-extra-points'));
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Blue Bamboo Hat');
  // stopping the capture is not needed to pause; the area and the lines are kept across a reload
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#apState')).toHaveText('Paused');
  await expect(page.locator('#apArea')).toHaveValue('any');
  expect(errors).toEqual([]);
});

test('orders the open shop by a column, most profit first, and remembers it', async ({ page }) => {
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  const shot = () => screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200));
  const names = async () => (await shopNames(page)).map((n) => n.trim());
  await loadShot(page, shot());
  const best = ['Dark Guardian', 'Bronze Chain Boots', 'Lemona', 'Bronze Chain Boots', 'Shoes Speed Scroll: Chaos', 'Cape INT Scroll: Lesser'];
  expect(await names()).toEqual(best);
  await expect(page.locator('#shopSortReset')).toBeHidden();

  // price each, cheapest first, then flipped
  await page.click('#shopTable th[data-col="unit"]');
  expect(await names()).toEqual(['Bronze Chain Boots', 'Bronze Chain Boots', 'Lemona', 'Shoes Speed Scroll: Chaos', 'Dark Guardian', 'Cape INT Scroll: Lesser']);
  await expect(page.locator('#shopTable th[data-col="unit"]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('#shopSortReset')).toBeVisible();
  await page.click('#shopTable th[data-col="unit"]');
  expect(await names()).toEqual(['Cape INT Scroll: Lesser', 'Dark Guardian', 'Shoes Speed Scroll: Chaos', 'Lemona', 'Bronze Chain Boots', 'Bronze Chain Boots']);
  await expect(page.locator('#shopTable th[data-col="unit"]')).toHaveAttribute('aria-sort', 'descending');

  // most profit first (by keyboard, too)
  await page.focus('#shopTable th[data-col="profit"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#shopTable th[data-col="profit"]')).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('#shopTable th[data-col="unit"]')).toHaveAttribute('aria-sort', 'none');
  expect(await names()).toEqual(['Dark Guardian', 'Bronze Chain Boots', 'Lemona', 'Bronze Chain Boots', 'Shoes Speed Scroll: Chaos', 'Cape INT Scroll: Lesser']);
  const profits = (await page.locator('#shopTable tbody tr td:nth-child(5)').allTextContents()).map((s) => Number(s.replace(/[^\d−-]/g, '').replace('−', '-')));
  expect(profits).toEqual([...profits].sort((a, b) => b - a));
  await page.click('#shopTable th[data-col="profit"]');
  expect((await names())[0]).toBe('Cape INT Scroll: Lesser');

  // it is still the order after a reload, for the next shop
  await page.click('#shopTable th[data-col="profit"]');
  await page.reload();
  await expect(page.locator('#shopTable th[data-col="profit"]')).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('#shopSortReset')).toBeVisible();
  await loadShot(page, shot());
  expect((await names())[0]).toBe('Dark Guardian');

  // back to deals first
  await page.click('#shopSortReset');
  await expect(page.locator('#shopSortReset')).toBeHidden();
  await expect(page.locator('#shopTable th[aria-sort="descending"], #shopTable th[aria-sort="ascending"]')).toHaveCount(0);
  expect(await names()).toEqual(best);
  expect(errors).toEqual([]);
});

test('orders the appraisal by a column, most valuable first, and remembers it', async ({ page }) => {
  const { errors } = await open(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await page.fill('#apAdd', 'Lemona\nWolbi Throwing Stars x2\nCape INT Scroll: Lesser x3\nMystery Thing x4\nShoes Speed Scroll: Chaos x5');
  await page.click('#apAddBtn');
  const names = async () => (await page.locator('#apBody .nm-n').allTextContents()).map((n) => n.trim());
  const added = ['Lemona', 'Wolbi Throwing Stars', 'Cape INT Scroll: Lesser', 'Mystery Thing', 'Shoes Speed Scroll: Chaos'];
  expect(await names()).toEqual(added);
  await expect(page.locator('#apSortReset')).toBeHidden();
  await expect(page.locator('#apOrder')).toHaveValue('added');

  // Total: the most valuable first; the line with no price goes last
  await page.click('#apTable th[data-col="total"]');
  expect(await names()).toEqual(['Cape INT Scroll: Lesser', 'Shoes Speed Scroll: Chaos', 'Lemona', 'Wolbi Throwing Stars', 'Mystery Thing']);
  await expect(page.locator('#apTable th[data-col="total"]')).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('#apOrder')).toHaveValue('total:-1');
  await expect(page.locator('#apSortReset')).toBeVisible();
  // the total does not change, and the copied list follows the order
  await expect(page.locator('#apTotal')).toHaveText('325,998');
  await page.click('#apCopyFull');
  const full = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect(full.slice(1, 3)).toEqual(['Cape INT Scroll: Lesser ×3 = 195,000', 'Shoes Speed Scroll: Chaos ×5 = 105,000']);

  // again flips it; a column of text starts A to Z
  await page.click('#apTable th[data-col="total"]');
  expect((await names()).slice(0, 2)).toEqual(['Wolbi Throwing Stars', 'Lemona']);
  await expect(page.locator('#apOrder')).toHaveValue('custom');
  await page.keyboard.press('Tab');
  await page.focus('#apTable th[data-col="name"]');
  await page.keyboard.press('Enter');
  expect(await names()).toEqual(['Cape INT Scroll: Lesser', 'Lemona', 'Mystery Thing', 'Shoes Speed Scroll: Chaos', 'Wolbi Throwing Stars']);
  await expect(page.locator('#apTable th[data-col="total"]')).toHaveAttribute('aria-sort', 'none');

  // the Order list does the same, which is how it works on a phone, where the headers are hidden
  await page.selectOption('#apOrder', 'qty:-1');
  expect((await names()).slice(0, 3)).toEqual(['Shoes Speed Scroll: Chaos', 'Mystery Thing', 'Cape INT Scroll: Lesser']);
  await expect(page.locator('#apTable th[data-col="qty"]')).toHaveAttribute('aria-sort', 'descending');

  // a line added now lands where the order says, and the choice survives a reload
  await page.fill('#apAdd', 'Traus x9');
  await page.click('#apAddBtn');
  expect((await names())[0]).toBe('Traus');
  await page.reload();
  await expect(page.locator('#apOrder')).toHaveValue('qty:-1');
  await expect(page.locator('#apSortReset')).toBeVisible();
  expect((await names())[0]).toBe('Traus');

  // back to the order they were added in
  await page.click('#apSortReset');
  await expect(page.locator('#apSortReset')).toBeHidden();
  expect(await names()).toEqual([...added, 'Traus']);
  expect(errors).toEqual([]);
});

test('uses what an NPC pays: a deal in the shop, a floor in the appraisal, and off when set to 0', async ({ page }) => {
  const { errors } = await open(page);
  // Lemona: the market says 21,000, an NPC shop sells it at 50,000 so an NPC pays 25,000 for it
  const withNpc = trackerPage([
    ['01472013', 'Dark Guardian', 'Weapons', 120000, 300, '🗡️'], ['01072044', 'Bronze Chain Boots', 'Equips', 12000, 60, '👢'],
    ['01082003', 'Lemona', 'Equips', 21000, 50, '🧤', 50000], ['02041019', 'Cape INT Scroll: Lesser', 'Scrolls', 65000, 955, '📜'],
    ['02040703', 'Shoes Speed Scroll: Chaos', 'Scrolls', 21000, 120, '📜'],
  ]);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(withNpc) });
  await expect(page.locator('#marketMsg')).toContainText('1 have an NPC shop price');
  await expect(page.locator('#marketAge')).toContainText('1 have an NPC shop price');

  // in the shop: Lemona at 19,999 is only "fair" by the market, but an NPC pays 5,001 more than it costs
  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  const lemona = page.locator('#shopTable tbody tr', { hasText: 'Lemona' });
  await expect(lemona.locator('.chip')).toHaveText('Deal');
  await expect(lemona.locator('td').nth(2)).toContainText('NPC 25,000');
  await expect(lemona.locator('td').nth(4)).toContainText('+5,001');
  await expect(page.locator('#dealProfit')).toContainText('selling to an NPC');
  await expect(page.locator('#dealList li', { hasText: 'Lemona' })).toContainText('an NPC pays 25,000 each for it');
  // the other listings have no NPC price
  await expect(page.locator('#shopTable tbody tr', { hasText: 'Dark Guardian' }).locator('td').nth(2)).not.toContainText('NPC');

  // in the appraisal: an NPC pays more than the market, so it is worth at least that
  await page.fill('#apAdd', 'Lemona x2\nCape INT Scroll: Lesser');
  await page.click('#apAddBtn');
  await expect(page.locator('#apTotal')).toHaveText('115,000');   // 2 × 25,000 + 65,000
  const row = page.locator('#apBody tr', { hasText: 'Lemona' });
  await expect(row).toContainText('NPC price');
  await expect(row).toContainText('NPC pays 25,000');
  await expect(row.locator('.chip')).toHaveText('Rough');

  // turned off, none of it applies
  await page.click('#rulesBox summary');
  await page.fill('#setNpc', '0');
  await page.press('#setNpc', 'Tab');
  await expect(lemona.locator('.chip')).not.toHaveText('Deal');
  await expect(lemona.locator('td').nth(2)).not.toContainText('NPC');
  // the table is judged afresh (only Dark Guardian is still a deal); the log keeps the alert that already went off
  await expect(page.locator('#shopTable tbody tr.v-deal')).toHaveCount(1);
  await expect(page.locator('#dealList li', { hasText: 'Lemona' })).toHaveCount(1);
  await expect(page.locator('#apTotal')).toHaveText('107,000');   // 2 × 21,000 + 65,000
  await expect(row).not.toContainText('NPC');

  // and the setting is kept
  await page.reload();
  await expect(page.locator('#setNpc')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('fits a phone screen without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('reads shops at every game and screen size', async ({ page }) => {
  test.setTimeout(600_000);
  await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  const WANT: Record<string, string[]> = {
    'shop-list.png': ['Bronze Chain Boots|9,999', 'Bronze Chain Boots|16,999', 'Cape INT Scroll: Lesser|99,999', 'Dark Guardian|79,999', 'Lemona|19,999', 'Shoes Speed Scroll: Chaos|29,999'],
    'shop-selected-row.png': Array<string>(5).fill('Wolbi Throwing Stars|2,999'),
  };
  const SIZES: [number, number, number][] = [
    [0.4, 1280, 800], [0.5, 1440, 900], [0.6, 1512, 982], [0.7, 1920, 1080], [0.8, 1920, 1200],
    [0.9, 2560, 1440], [1.0, 3024, 1964], [1.25, 3024, 1964], [1.5, 3456, 2234],
  ];
  let total = 0, read = 0, wrong = 0;
  const misses: string[] = [];
  for (const [file, want] of Object.entries(WANT)) {
    for (const [f, sw, sh] of SIZES) {
      await loadShot(page, screenFile('shot.png', placeOn(scaleBy(loadPng(file), f), sw, sh, Math.round(sw * 0.3), Math.round(sh * 0.2))));
      // one table row per listing, ×N for identical ones
      const got = await page.locator('#shopTable tbody tr').evaluateAll((trs) => trs.flatMap((tr) => {
        const name = tr.querySelector('.nm-n')?.childNodes[0]?.textContent?.trim() ?? '';
        const n = Number(tr.querySelector('.cnt')?.textContent?.replace('×', '') ?? 1);
        const price = (tr.querySelector('.sub')?.textContent ?? '').match(/for ([\d,]+)/)?.[1] ?? '';
        return Array<string>(n).fill(`${name}|${price}`);
      }));
      const left = [...want];
      for (const g of got) { const i = left.indexOf(g); if (i >= 0) left.splice(i, 1); else wrong++; }
      total += want.length; read += want.length - left.length;
      if (left.length || got.length !== want.length) misses.push(`${file} at ${f}: got ${JSON.stringify(got)}`);
    }
  }
  console.log(`browser: read ${read}/${total}, wrong ${wrong}\n${misses.join('\n')}`);
  expect(read / total).toBeGreaterThanOrEqual(0.97);
  expect(wrong / total).toBeLessThanOrEqual(0.02);
});
