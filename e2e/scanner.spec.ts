import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fadeText, loadPng, placeOn, scaleBy } from '../tests/helpers/image';
import type { Pixels } from '../src/vision/pixels';
import { HOVER_ITEMS, hoverId } from '../tests/helpers/hover';

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
const HOVER_TRACKER = trackerPage(HOVER_ITEMS.map((it): TrackerRow => [`0${hoverId(it)}`, it.n, it.c, it.p ?? 0, it.s, '📦']));

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

/**
 * Start capture shares a canvas the test draws on, in place of the screen. `show` puts a screen-sized picture on
 * it, and the share sends it on as a new frame, as a screen does when the game changes.
 */
async function shareCanvas(page: Page): Promise<(file: ReturnType<typeof screenFile>) => Promise<void>> {
  await page.addInitScript(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1440, height: 900 });
    (window as unknown as { shared: HTMLCanvasElement }).shared = canvas;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const stream = canvas.captureStream(5), ctx = canvas.getContext('2d')!;
      // an empty desktop to begin with: a share starts with a frame
      ctx.fillStyle = 'rgb(52, 70, 48)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return stream;
    };
  });
  return (file) => page.evaluate(async (png) => {
    const picture = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    (window as unknown as { shared: HTMLCanvasElement }).shared.getContext('2d')!.drawImage(picture, 0, 0);
  }, file.buffer.toString('base64'));
}

/** Counts the text reader's passes from now on. */
async function countPasses(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { FM: { reader: { recognize(img: unknown): Promise<unknown> } }; passes: number };
    const read = w.FM.reader.recognize.bind(w.FM.reader);
    w.passes = 0;
    w.FM.reader.recognize = (img) => { w.passes++; return read(img); };
  });
  return () => page.evaluate(() => (window as unknown as { passes: number }).passes);
}

const shopNames = (page: Page) => page.locator('#shopTable tbody .nm-n').allTextContents();

/** Opens a view by its tab in the bar. */
const view = (page: Page, name: 'deals' | 'inventory' | 'prices' | 'settings') => page.click(`#tab-${name}`);

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
  await expect(page.locator('#marketMsg')).toContainText('Loaded 1 file: 7 market prices for Windia now');

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
  await view(page, 'prices');
  await expect(page.locator('#bookTable tbody')).toContainText('Dark Guardian');
  expect(errors).toEqual([]);
});

test('takes a listing that sells while the shop is open out of the table, and keeps its Sold twin', async ({ page }) => {
  const show = await shareCanvas(page);
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  const list = loadPng('shop-list.png');
  const screen = (shop: Pixels) => screenFile('screen.png', placeOn(scaleBy(shop, 0.5), 1440, 900, 400, 200));
  await page.click('#btnStart');
  await expect(page.locator('#statusText')).toContainText('Watching for shops');
  await show(screen(list));
  await expect(page.locator('#statusText')).toContainText('Shop open, 6 listings');
  const guardian = page.locator('#shopTable tbody tr', { hasText: 'Dark Guardian' });
  await expect(guardian.locator('.chip')).toHaveText('Deal');

  // someone buys the Dark Guardian: the game greys its row, and the live listing leaves the table for its Sold twin.
  // The frame hardly changes, so the scanner reads it again when the last read is 3 seconds old, and once more to confirm.
  await show(screen(fadeText(list, { x: 118, y: 18, w: 410, h: 90 })));
  await expect(guardian.locator('.chip')).toHaveText('Sold', { timeout: 15_000 });
  await expect(guardian).toHaveCount(1);
  await expect(page.locator('#shopTable tbody tr.v-deal')).toHaveCount(0);
  // the deal it was stays in the log
  await expect(page.locator('#dealList li', { hasText: 'Dark Guardian' })).toHaveCount(1);
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

test("measures a hovered item's stats against the game data's slots and base stats", async ({ page }) => {
  const { errors } = await open(page);
  // once misread with 9 slots: on its own, the scanner takes that as the most a Traus can have
  await page.evaluate(() => localStorage.setItem('fmscan.v1.db', JSON.stringify({ items: { traus: { name: 'Traus', manualRef: null, buyUnder: null, s: [], maxSlots: 9 } } })));
  const hovered = async (facts: number) => {
    await page.reload();
    await page.waitForFunction((n) => (window as unknown as { FM: { engine: { facts: Map<number, unknown> } } }).FM.engine.facts.size === n, facts);
    await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
    await loadShot(page, screenFile('hover.png', hoverOverShop(1, 2560, 1600)));
    return page.locator('#hoverLine');
  };
  await page.route('**/fm-deal-scanner/equips.json', (r) => r.fulfill({ status: 404 }));
  await expect(await hovered(0)).toContainText('Traus: −2 att, 2 of 9 slots used. Worth about 37,400');

  // the game data says a Traus has 7
  await page.unroute('**/fm-deal-scanner/equips.json');
  await page.route('**/fm-deal-scanner/equips.json', (r) => r.fulfill({ contentType: 'application/json', body: readFileSync('tests/fixtures/equips.sample.json') }));
  await expect(await hovered(9)).toContainText('Traus: −2 att, 7 slots left. Worth about 46,200');
  // the browser logs the missing file of the first run; nothing else went wrong
  expect(errors.filter((e) => !e.includes('status of 404'))).toEqual([]);
});

test('keeps your data from the single-file scanner', async ({ page }) => {
  const { icons } = await open(page);
  const backup = {
    version: 1, exported: '2026-11-03T10:00:00.000Z',
    db: { items: { lemona: { name: 'Lemona', manualRef: 25000, buyUnder: 15000, s: [[Date.now() - 3600e3, 19999, 1]] } } },
    settings: {}, region: null,
  };
  await page.setInputFiles('#fileImport', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#dataMsg')).toHaveText('Imported 1 item. Restored your settings.');
  await view(page, 'prices');
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

test('values a pile of items typed in, copies the store prices, and keeps it', async ({ page }) => {
  const { errors } = await open(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await expect(page.locator('#marketMsg')).toContainText('7 market prices for Windia now');
  await view(page, 'inventory');
  // empty: one line says so, and no totals of 0
  await expect(page.locator('#apMeta')).toHaveText('');
  await expect(page.locator('#apTotals')).toBeHidden();
  await expect(page.locator('#apEmpty')).toBeVisible();
  // no offer for everything at once, and no settings on the view: they are in Settings
  await expect(page.locator('#view-inventory')).not.toContainText(/sell everything|offer/i);
  await expect(page.locator('#view-inventory [data-setting]')).toHaveCount(0);

  // + Add by name opens its box under the toolbar, focused; Esc and Cancel close it
  await expect(page.locator('#apAddBox')).toBeHidden();
  await page.click('#apAddOpen');
  await expect(page.locator('#apAddBox')).toBeVisible();
  await expect(page.locator('#apAddOpen')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#apAdd')).toBeFocused();
  await page.press('#apAdd', 'Escape');
  await expect(page.locator('#apAddBox')).toBeHidden();
  await expect(page.locator('#apAddOpen')).toBeFocused();
  await page.click('#apAddOpen');
  await page.click('#apAddCancel');
  await expect(page.locator('#apAddBox')).toBeHidden();
  await page.click('#apAddOpen');
  await page.fill('#apAdd', 'Cape INT Scroll: Lesser x3\nShoes Speed Scroll: Chaos x5\nLemona\nWolbi Throwing Stars x2\nMystery Thing x4');
  await page.click('#apAddBtn');
  await expect(page.locator('#apBody tr')).toHaveCount(5);
  await expect(page.locator('#apMsg')).toHaveText('Added 5 items.');
  // all read: the box closes
  await expect(page.locator('#apAddBox')).toBeHidden();
  await expect(page.locator('#apTotals')).toBeVisible();
  // in the order they were added
  expect((await page.locator('#apBody .nm-n').allTextContents()).map((n) => n.trim()))
    .toEqual(['Cape INT Scroll: Lesser', 'Shoes Speed Scroll: Chaos', 'Lemona', 'Wolbi Throwing Stars', 'Mystery Thing']);
  // 3 × 65,000 + 5 × 21,000 + 21,000 + 2 sets × 2,499; the unknown item has no price
  await expect(page.locator('#apTotal')).toHaveText('325,998');
  await expect(page.locator('#apStore')).toHaveText('325,998');
  await expect(page.locator('#apMeta')).toHaveText('5 items');
  await expect(page.locator('#apNoPrice')).toHaveText('1 has no price');
  await expect(page.locator('#apLeft')).toHaveText('1 item not counted: no price');
  await expect(page.locator('#apBody tr', { hasText: 'Wolbi' })).toContainText('priced per set');

  // type a price for the unknown item in its List at box: it counts, and the warning goes
  const mystery = page.locator('#apBody tr', { hasText: 'Mystery Thing' });
  await mystery.locator('input[data-field="price"]').fill('1k');
  await mystery.locator('input[data-field="price"]').press('Tab');
  await expect(page.locator('#apTotal')).toHaveText('329,998');
  await expect(page.locator('#apLeft')).toHaveText('');
  await expect(page.locator('#apNoPrice')).toBeHidden();
  await expect(page.locator('#apBody tr', { hasText: 'Mystery Thing' }).locator('.chip')).toHaveText('Priced');

  // Copy store prices, beside the store's total: what to type in the store, one line per item
  await page.click('#apCopyStore');
  await expect(page.locator('#apMsg')).toHaveText('Copied the store prices.');
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
  expect(copied).toHaveLength(5);
  expect(copied[2]).toBe('Lemona ×1: 21,000');

  // a skipped line is left out of the worth; Asking (in Settings) reads the same without sightings
  await page.locator('#apBody tr', { hasText: 'Lemona' }).locator('button[data-act="skip"]').click();
  await expect(page.locator('#apTotal')).toHaveText('308,998');
  await expect(page.locator('#apMeta')).toHaveText('4 items');
  await expect(page.locator('#apLeft')).toHaveText('1 skipped');
  await view(page, 'settings');
  await page.selectOption('#set-appraisalMode', 'greedy');
  await view(page, 'inventory');
  await expect(page.locator('#apTotal')).toHaveText('308,998');

  // all of it is still there after a reload
  await page.reload();
  await expect(page.locator('#apBody tr')).toHaveCount(5);
  await expect(page.locator('#apTotal')).toHaveText('308,998');
  await expect(page.locator('#apBody tr', { hasText: 'Lemona' }).locator('.chip')).toHaveText('Skipped');
  await view(page, 'settings');
  await expect(page.locator('#set-appraisalMode')).toHaveValue('greedy');
  await view(page, 'inventory');

  // remove one line, then clear the rest: the button asks first, a second click clears
  await page.locator('#apBody tr', { hasText: 'Mystery Thing' }).locator('button[data-act="del"]').click();
  await expect(page.locator('#apBody tr')).toHaveCount(4);
  await page.click('#apClear');
  await expect(page.locator('#apClear')).toHaveText('Click again to clear');
  await expect(page.locator('#apBody tr')).toHaveCount(4);
  await page.click('#apClear');
  await expect(page.locator('#apBody tr')).toHaveCount(0);
  await expect(page.locator('#apClear')).toHaveText('Clear');
  await expect(page.locator('#apMeta')).toHaveText('');
  await expect(page.locator('#apTotals')).toBeHidden();
  await expect(page.locator('#apEmpty')).toBeVisible();
  // nothing a player reads calls it an appraisal, or counts kinds
  expect(await page.locator('#view-inventory').innerText()).not.toMatch(/apprais|kinds/i);
  expect(errors).toEqual([]);
});

test('asks for the counts of stacks: only those shown, Enter moving to the next', async ({ page }) => {
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await view(page, 'inventory');
  await page.click('#apAddOpen');
  await page.fill('#apAdd', 'Red Potion\nCape INT Scroll: Lesser\nShoes Speed Scroll: Chaos x5\nLemona\nWolbi Throwing Stars');
  await page.click('#apAddBtn');
  const rows = page.locator('#apBody tr'), qty = (name: string) => rows.filter({ hasText: name }).locator('input[data-field="qty"]');
  await expect(rows).toHaveCount(5);
  // Lemona is an equip and the scrolls ×5 have their count: three stacks are still at 1
  await expect(page.locator('#apNeedCount')).toHaveText('3 need a count');
  await expect(rows.locator('.cellinput.need')).toHaveCount(3);
  await page.click('#apNeedCount');
  await expect(page.locator('#apNeedCount')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(3);
  expect((await rows.locator('.nm-n').allTextContents()).map((n) => n.trim())).toEqual(['Red Potion', 'Cape INT Scroll: Lesser', 'Wolbi Throwing Stars']);

  // type a count and press Enter: the line has its count, and the next box is ready to type in
  await qty('Red Potion').fill('12');
  await qty('Red Potion').press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#apNeedCount')).toHaveText('2 need a count');
  await expect(qty('Cape INT Scroll: Lesser')).toBeFocused();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(qty('Wolbi Throwing Stars')).toBeFocused();
  // a count of 1 typed is a count too
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  // none left: every item shows again
  await expect(rows).toHaveCount(5);
  await expect(page.locator('#apNeedWrap')).toBeHidden();
  await expect(rows.locator('.cellinput.need')).toHaveCount(0);
  await expect(page.locator('#apTotal')).toHaveText(String((3 * 65000 + 5 * 21000 + 21000 + 2499).toLocaleString('en-US')));

  // without the filter, Enter moves along all the lines, and the counts are kept
  await qty('Red Potion').fill('20');
  await qty('Red Potion').press('Enter');
  await expect(qty('Cape INT Scroll: Lesser')).toBeFocused();
  await page.reload();
  await expect(qty('Red Potion')).toHaveValue('20');
  await expect(page.locator('#apNeedWrap')).toBeHidden();
  expect(errors).toEqual([]);
});

test('adds the items you hover to your inventory, and only while scanning', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(HOVER_TRACKER) });
  await expect(page.locator('#marketMsg')).toContainText('10 market prices for Windia now');
  const screen = (name: string) => screenFile(`${name}.png`, placeOn(loadPng(`appraisal/${name}.png`), 1440, 900, 100, 100));
  const rows = page.locator('#apBody tr');
  await view(page, 'inventory');

  // nothing shared yet: Scan my items starts the capture, and scanning with it, in one press
  await page.click('#apScan');
  await expect(page.locator('#btnStop')).toBeVisible();
  await expect(page.locator('#apScan')).toHaveText('Pause');
  await expect(page.locator('#apScan')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#statusText')).toContainText('Scanning your items');
  // paused while the share runs: the button says Resume, and so does the status line
  await page.click('#apScan');
  await expect(page.locator('#apScan')).toHaveText('Resume');
  await expect(page.locator('#apScan')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#statusText')).toContainText('Paused');
  await page.click('#btnStop');
  await expect(page.locator('#apScan')).toHaveText('Scan my items');

  // a screenshot to scan, then start: the scroll under the mouse is added, with its count flagged for typing
  await loadShot(page, screen('use-scroll-inventory'));
  await page.click('#apScan');
  await expect(page.locator('#apScan')).toHaveText('Pause');
  await expect(page.locator('#apScan')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Overall Armor LUK Scroll: Greater');
  await expect(rows.first().locator('.cellinput.need')).toHaveCount(1);
  await expect(page.locator('#apHint')).toContainText('type how many you have');
  await expect(page.locator('#statusText')).toContainText('Scanning your items');

  // another item, in the trade window: an equip, with its stats
  await loadShot(page, screen('trade-equip'));
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Lemona');
  await expect(rows.nth(1).locator('.cellinput.need')).toHaveCount(0);
  await expect(page.locator('#apTotal')).toHaveText('29,499');   // 27,499 + 2,000

  // a hover that is a repeat adds nothing
  await loadShot(page, screen('trade-equip'));
  await expect(rows).toHaveCount(2);

  // type the count of the scroll: no longer in doubt
  await rows.first().locator('input[data-field="qty"]').fill('3');
  await rows.first().locator('input[data-field="qty"]').press('Tab');
  await expect(rows.first().locator('.cellinput.need')).toHaveCount(0);
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
  await expect(page.locator('#apScan')).toHaveText('Scan my items');
  await loadShot(page, screen('equip-not-worn'));
  await expect(rows).toHaveCount(2);

  // with an area marked far from the tooltip, hovering adds nothing either
  await view(page, 'settings');
  await page.click('#btnMarkItems');
  await expect(page.locator('#calib')).toBeVisible();
  await expect(page.locator('#hCalib')).toHaveText('Mark the area of items');
  const box = (await page.locator('#calibCanvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.03);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.96, box.y + box.height * 0.13, { steps: 5 });
  await page.mouse.up();
  await page.click('#calibSave');
  await expect(page.locator('#calib')).toBeHidden();
  await expect(page.locator('#set-appraisalArea')).toHaveValue('marked');
  await view(page, 'inventory');
  await page.click('#apScan');
  await expect(page.locator('#apScan')).toHaveText('Pause');
  await expect(rows).toHaveCount(2);   // the screenshot on screen has its tooltip far from the box
  await loadShot(page, screen('equip-not-worn'));
  await expect(rows).toHaveCount(2);
  // back to anywhere: it is counted
  await view(page, 'settings');
  await page.selectOption('#set-appraisalArea', 'any');
  await loadShot(page, screen('equip-extra-points'));
  await view(page, 'inventory');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Blue Bamboo Hat');
  // stopping the capture is not needed to pause; the area and the lines are kept across a reload
  await page.reload();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#apScan')).toHaveText('Scan my items');
  await view(page, 'settings');
  await expect(page.locator('#set-appraisalArea')).toHaveValue('any');
  expect(errors).toEqual([]);
});

test('reads an item you hover in Inventory once, and shows none of it in Deals', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(HOVER_TRACKER) });
  await view(page, 'inventory');
  const passes = await countPasses(page);
  await loadShot(page, screenFile('hover.png', placeOn(loadPng('appraisal/trade-equip.png'), 1440, 900, 100, 100)));
  expect(await passes()).toBe(0);   // not scanning: nothing is read
  await page.click('#apScan');
  await expect(page.locator('#apBody tr')).toHaveCount(1);
  expect(await passes()).toBe(1);
  await tenChecks(page);
  expect(await passes()).toBe(1);   // still on screen: not read again
  // the open shop in Deals knows nothing of it: no shop, no hovered item
  expect(await page.evaluate(() => {
    const s = (window as unknown as { FM: { session: { open: boolean; hover: unknown } } }).FM.session;
    return { open: s.open, hover: s.hover };
  })).toEqual({ open: false, hover: null });
  expect(errors).toEqual([]);
});

test('sets up your store: the item hovered last stands out with its List at price, and the prices follow List at', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await open(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(HOVER_TRACKER) });
  const screen = (name: string) => screenFile(`${name}.png`, placeOn(loadPng(`appraisal/${name}.png`), 1440, 900, 100, 100));
  const rows = page.locator('#apBody tr'), listAt = (n: number) => rows.nth(n).locator('input[data-field="price"]');
  await view(page, 'inventory');

  // hover an equip: it is added, highlighted, with what to list it at
  await loadShot(page, screen('trade-equip'));
  await page.click('#apScan');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Lemona');
  await expect(rows.first()).toHaveClass(/\blast\b/);
  await expect(listAt(0)).toHaveValue('2,000');
  await expect(page.locator('#apStore')).toHaveText('2,000');
  // a scroll next: the highlight moves to it
  await loadShot(page, screen('use-scroll-inventory'));
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveClass(/\blast\b/);
  await expect(rows.first()).not.toHaveClass(/\blast\b/);
  await expect(page.locator('#apBody tr.last')).toHaveCount(1);
  await expect(page.locator('#apTotal')).toHaveText('29,499');

  // List at 10% over, in Settings: each List at price and In your store follow; the worth stays
  await view(page, 'settings');
  await page.fill('#set-storeAdjust', '10');
  await page.press('#set-storeAdjust', 'Tab');
  await view(page, 'inventory');
  await expect(listAt(0)).toHaveValue('2,200');
  await expect(listAt(1)).toHaveValue('30,249');   // 27,499 × 1.1
  await expect(page.locator('#apStore')).toHaveText('32,449');
  await expect(page.locator('#apTotal')).toHaveText('29,499');

  // a price typed in List at is that item's own price, as typed
  await listAt(0).fill('2,500');
  await listAt(0).press('Tab');
  await expect(listAt(0)).toHaveValue('2,500');
  await expect(rows.first()).toContainText('typed here');
  await expect(page.locator('#apStore')).toHaveText('32,749');
  await expect(page.locator('#apTotal')).toHaveText('29,999');

  // the store prices, copied, in the order the items were added
  await page.click('#apCopyStore');
  await expect(page.locator('#apMsg')).toHaveText('Copied the store prices.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Lemona ×1: 2,500\nOverall Armor LUK Scroll: Greater ×1: 30,249');
  expect(errors).toEqual([]);
});

test('keeps what you are typing in List at when a hover comes in meanwhile', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(HOVER_TRACKER) });
  const screen = (name: string) => screenFile(`${name}.png`, placeOn(loadPng(`appraisal/${name}.png`), 1440, 900, 100, 100));
  const rows = page.locator('#apBody tr'), listAt = rows.first().locator('input[data-field="price"]');
  await view(page, 'inventory');
  await loadShot(page, screen('trade-equip'));
  await page.click('#apScan');
  await expect(rows).toHaveCount(1);
  await expect(listAt).toHaveValue('2,000');

  // half way through typing a price, the next item is hovered: what is typed stays, and the hint says what came in
  await listAt.fill('2,7');
  await loadShot(page, screen('use-scroll-inventory'));
  await expect(page.locator('#apHint')).toContainText('Added Overall Armor LUK Scroll: Greater');
  await expect(listAt).toBeFocused();
  await expect(listAt).toHaveValue('2,7');
  await expect(rows).toHaveCount(1);
  await page.keyboard.type('50');

  // done typing: the price is the line's own, and the hovered item's line shows, highlighted
  await listAt.press('Tab');
  await expect(rows).toHaveCount(2);
  await expect(listAt).toHaveValue('2,750');
  await expect(rows.first()).toContainText('typed here');
  await expect(rows.nth(1)).toHaveClass(/\blast\b/);
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

test('uses what an NPC pays: a deal in the shop, a floor in your inventory, and off when set to 0', async ({ page }) => {
  const { errors } = await open(page);
  // Lemona: the market says 21,000, an NPC shop sells it at 50,000 so an NPC pays 25,000 for it
  const withNpc = trackerPage([
    ['01472013', 'Dark Guardian', 'Weapons', 120000, 300, '🗡️'], ['01072044', 'Bronze Chain Boots', 'Equips', 12000, 60, '👢'],
    ['01082003', 'Lemona', 'Equips', 21000, 50, '🧤', 50000], ['02041019', 'Cape INT Scroll: Lesser', 'Scrolls', 65000, 955, '📜'],
    ['02040703', 'Shoes Speed Scroll: Chaos', 'Scrolls', 21000, 120, '📜'],
  ]);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(withNpc) });
  await expect(page.locator('#marketMsg')).toContainText('1 have an NPC shop price');
  await view(page, 'prices');
  await expect(page.locator('#marketAge')).toContainText('1 have an NPC shop price');
  await view(page, 'deals');

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

  // turned off, none of it applies: the open shop is judged afresh (only Dark Guardian is still a deal), and
  // the log keeps the alert that already went off
  await view(page, 'settings');
  await page.fill('#set-npcRatio', '0');
  await page.press('#set-npcRatio', 'Tab');
  await view(page, 'deals');
  await expect(lemona.locator('.chip')).not.toHaveText('Deal');
  await expect(lemona.locator('td').nth(2)).not.toContainText('NPC');
  await expect(page.locator('#shopTable tbody tr.v-deal')).toHaveCount(1);
  await expect(page.locator('#dealList li', { hasText: 'Lemona' })).toHaveCount(1);

  // in your items: an NPC pays more than the market, so it is worth at least that
  await view(page, 'settings');
  await page.fill('#set-npcRatio', '50');
  await page.press('#set-npcRatio', 'Tab');
  await view(page, 'inventory');
  await page.click('#apAddOpen');
  await page.fill('#apAdd', 'Lemona x2\nCape INT Scroll: Lesser');
  await page.click('#apAddBtn');
  await expect(page.locator('#apTotal')).toHaveText('115,000');   // 2 × 25,000 + 65,000
  const row = page.locator('#apBody tr', { hasText: 'Lemona' });
  await expect(row).toContainText('NPC price');
  await expect(row).toContainText('NPC pays 25,000');
  await expect(row.locator('.chip')).toHaveText('Rough');
  // turned off again, the floor goes
  await view(page, 'settings');
  await page.fill('#set-npcRatio', '0');
  await page.press('#set-npcRatio', 'Tab');
  await view(page, 'inventory');
  await expect(page.locator('#apTotal')).toHaveText('107,000');   // 2 × 21,000 + 65,000
  await expect(row).not.toContainText('NPC');

  // and the setting is kept
  await page.reload();
  await view(page, 'settings');
  await expect(page.locator('#set-npcRatio')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('shows one view at a time, by tab, by address and by keyboard, and remembers the last', async ({ page }) => {
  const { errors } = await open(page);
  const shown = () => page.locator('[role="tabpanel"]:not([hidden])');
  await expect(shown()).toHaveAttribute('id', 'view-deals');
  await expect(page.locator('#tab-deals')).toHaveAttribute('aria-selected', 'true');
  const mode = () => page.evaluate(() => JSON.parse(localStorage.getItem('fmscan.v1.settings')!).mode as string);
  // Settings is a tab in the row like the others, as tall and labelled
  await expect(page.locator('[role="tablist"] [role="tab"]')).toHaveText(['Deals', 'Inventory', 'Prices', '⚙Settings']);
  const deals = (await page.locator('#tab-deals').boundingBox())!, gear = (await page.locator('#tab-settings').boundingBox())!;
  expect(gear.height).toBe(deals.height);
  expect(gear.width).toBeGreaterThan(deals.width);
  // nothing in the bar moves from one view to the next, and the page keeps the scrollbar's room either way
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)).toBe('stable');
  const places = () => page.evaluate(() => ['#tab-deals', '#status', '#btnStart'].map((q) => Math.round(document.querySelector(q)!.getBoundingClientRect().x)));
  const at = await places();

  // a tab: the address follows, and opening Inventory sets the mode
  await view(page, 'inventory');
  await expect(shown()).toHaveAttribute('id', 'view-inventory');
  await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
  expect(new URL(page.url()).hash).toBe('#inventory');
  expect(await mode()).toBe('inventory');
  expect(await places()).toEqual(at);

  // the arrows move along the tabs, round the end; Prices and Settings leave the mode alone
  await page.focus('#tab-inventory');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-prices')).toBeFocused();
  await expect(shown()).toHaveAttribute('id', 'view-prices');
  expect(await places()).toEqual(at);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-settings')).toBeFocused();
  await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true');
  expect(await mode()).toBe('inventory');
  expect(await places()).toEqual(at);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-deals')).toBeFocused();
  await page.keyboard.press('End');
  await expect(shown()).toHaveAttribute('id', 'view-settings');

  // the last view is kept, also without the address
  await page.goto('./');
  await expect(shown()).toHaveAttribute('id', 'view-settings');
  // and the address opens a view
  await page.goto('./#prices');
  await expect(shown()).toHaveAttribute('id', 'view-prices');
  await page.evaluate(() => { location.hash = '#deals'; });
  await expect(shown()).toHaveAttribute('id', 'view-deals');
  expect(await mode()).toBe('deals');
  expect(errors).toEqual([]);
});

test('the status line shows in full in a window 1000 px wide', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const show = await shareCanvas(page);
  const { errors } = await open(page);
  // nothing in it is cut off: its words fit the lines it shows
  const whole = () => page.locator('#statusText').evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
  // idle, it says only that: the Start capture button beside it says the rest
  await expect(page.locator('#statusText')).toHaveText('Not capturing.');
  expect(await whole()).toBe(true);
  await page.click('#btnStart');
  await expect(page.locator('#statusText')).toContainText('Watching for shops');
  expect(await whole()).toBe(true);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await show(screenFile('screen.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  await expect(page.locator('#statusText')).toContainText('Shop open, 6 listings');
  expect(await whole()).toBe(true);
  // Inventory with the share running: your items are scanned at once
  await view(page, 'inventory');
  await expect(page.locator('#statusText')).toContainText('Scanning your items. Point at items in the game and they are added.');
  expect(await whole()).toBe(true);
  await page.click('#apScan');
  await expect(page.locator('#statusText')).toContainText('Paused. Press Resume to add the items you point at.');
  expect(await whole()).toBe(true);
  expect(errors).toEqual([]);
});

test('keeps a setting within its limits as it is typed, and in step wherever it is shown', async ({ page }) => {
  const { errors } = await open(page);
  await view(page, 'settings');
  for (const [key, typed, kept] of [['discount', '-50', '5'], ['fee', '500', '20'], ['interval', '0.01', '0.4']] as const) {
    await page.fill(`#set-${key}`, typed);
    await page.press(`#set-${key}`, 'Tab');
    await expect(page.locator(`#set-${key}`)).toHaveValue(kept);
  }
  // a number box takes what the browser hands over, a leading dot or three decimals too
  for (const [key, typed, kept] of [['interval', '.5', '0.5'], ['statPct', '0.500', '0.5']] as const) {
    await page.fill(`#set-${key}`, typed);
    await page.press(`#set-${key}`, 'Tab');
    await expect(page.locator(`#set-${key}`)).toHaveValue(kept);
  }
  await page.reload();
  await expect(page.locator('#set-discount')).toHaveValue('5');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fmscan.v1.settings')!))).toMatchObject({ discount: 5, fee: 20, interval: 0.5, statPct: 0.5 });

  // mesos are typed the short way or with commas, and shown with their thousands apart; what can't be read leaves the setting as it was
  const profit = page.locator('#set-minProfit');
  await expect(profit).toHaveValue('3,000');
  for (const [typed, kept] of [['12500', '12,500'], ['5k', '5,000'], ['12 500', '5,000'], ['1.5m', '1,500,000'], ['-1', '0']] as const) {
    await profit.fill(typed);
    await profit.press('Tab');
    await expect(profit, typed).toHaveValue(kept);
  }
  await page.reload();
  await expect(profit).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('shows the Get started steps to someone new, ticks them off, and never again once done', async ({ page }) => {
  const { errors } = await open(page);
  const card = page.locator('#dealsSetup'), steps = card.locator('li');
  await expect(card).toBeVisible();
  await expect(steps.locator('.what')).toHaveText(['Load market prices', 'Start capture', 'Open a shop']);
  await expect(steps.getByRole('button')).toHaveText(['Go to Prices', 'Start capture']);
  await expect(page.locator('#dealsSetup li.done')).toHaveCount(0);

  // the first step's button opens Prices; with prices loaded, it is ticked
  await card.getByRole('button', { name: 'Go to Prices' }).click();
  await expect(page.locator('#view-prices')).toBeVisible();
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await view(page, 'deals');
  await expect(steps.nth(0)).toHaveClass(/done/);
  await expect(steps.nth(0)).toContainText('(done)');
  await expect(steps.nth(0).getByRole('button')).toHaveCount(0);
  await expect(page.locator('#dealsSetup li.done')).toHaveCount(1);

  // a shop read: the last two are done too, and the card goes, also after a reload
  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.locator('#shopMeta')).toHaveText('No shop open');
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

// Capture shares Chromium's stand-in screen (see playwright.config.ts): it starts with no picker, and never shows a shop.
test('starts capture from Get started, and offers to mark the shop area when none is found for a while', async ({ page }) => {
  const { errors } = await open(page);
  const steps = page.locator('#dealsSetup li'), help = page.locator('#shopHelp');
  await steps.nth(1).getByRole('button', { name: 'Start capture' }).click();
  await expect(page.locator('#statusText')).toContainText('Watching for shops');
  await expect(steps.nth(1)).toHaveClass(/done/);
  await expect(page.locator('#dealsSetup')).toBeVisible();
  await expect(help).toBeHidden();

  // 15 seconds with no shop: one line offers to mark its area, which opens the marking dialog
  await expect(help).toHaveText('Not finding the shop? Mark its area', { timeout: 40_000 });
  await help.getByRole('button', { name: 'Mark its area' }).click();
  await expect(page.locator('#calib')).toBeVisible();
  await expect(page.locator('#hCalib')).toHaveText("Mark the shop's item list");
  await page.click('#calibCancel');

  // not looking any more: it goes
  await page.click('#btnStop');
  await expect(help).toBeHidden();
  await expect(steps.nth(1)).not.toHaveClass(/done/);
  expect(errors).toEqual([]);
});

test('shows Inventory its own Get started steps, until there is an item', async ({ page }) => {
  const { errors } = await open(page);
  await view(page, 'inventory');
  const card = page.locator('#invSetup'), steps = card.locator('li');
  await expect(card).toBeVisible();
  // Scan my items starts the capture itself: no step for it
  await expect(steps.locator('.what')).toHaveText(['Load market prices', 'Press Scan my items and point at your items in the game']);
  await expect(steps.getByRole('button')).toHaveText(['Go to Prices']);
  await card.getByRole('button', { name: 'Go to Prices' }).click();
  await expect(page.locator('#view-prices')).toBeVisible();
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await view(page, 'inventory');
  await expect(steps.nth(0)).toHaveClass(/done/);
  await expect(page.locator('#invSetup li.done')).toHaveCount(1);
  // an item, here added by name: under way, and the card goes, also after a reload
  await page.click('#apAddOpen');
  await page.fill('#apAdd', 'Lemona');
  await page.click('#apAddBtn');
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.locator('#apBody tr')).toHaveCount(1);
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});

test('the overlay follows the mode, and its switch sets the mode for the page', async ({ page }) => {
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await page.click('#btnStart');
  await expect(page.locator('#statusText')).toContainText('Watching for shops');
  await page.click('#btnPip');
  /** The overlay's window, read and clicked from the page that opened it. */
  type Pip = { documentPictureInPicture: { window: Window | null } };
  const overlay = () => page.evaluate(() => (window as unknown as Pip).documentPictureInPicture.window?.document.getElementById('pipRoot')?.innerHTML ?? '');
  const press = (act: string) => page.evaluate((a) => (window as unknown as Pip).documentPictureInPicture.window!.document.querySelector<HTMLElement>(`[data-act="${a}"]`)!.click(), act);
  await expect.poll(overlay).toContain('<button data-act="mode-deals" aria-pressed="true">Deals</button>');
  expect(await overlay()).toContain('Open a shop in the game.');

  // Inventory in the overlay: the page opens Inventory, and the overlay shows your items
  await press('mode-inventory');
  await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveAttribute('id', 'view-inventory');
  await expect.poll(overlay).toContain('<button data-act="mode-inventory" aria-pressed="true">Inventory</button>');
  expect(await overlay()).toContain('<b>0</b><span class="dim">0 items</span>');
  // the share is running: scanning your items starts with the switch, and the page knows
  await expect(page.locator('#apScan')).toHaveText('Pause');
  await expect.poll(overlay).toContain('>Pause</button>');
  // paused from the overlay: both say Resume, and it resumes from there too
  await press('scan');
  await expect(page.locator('#apScan')).toHaveText('Resume');
  await expect.poll(overlay).toContain('>Resume</button>');
  await press('scan');
  await expect(page.locator('#apScan')).toHaveText('Pause');
  // items added on the page show in the overlay's worth
  await page.click('#apAddOpen');
  await page.fill('#apAdd', 'Lemona x2');
  await page.click('#apAddBtn');
  await expect.poll(overlay).toContain('<b>42,000</b><span class="dim">1 item</span>');

  // on Prices, the switch sets the mode and the page stays where it is
  await view(page, 'prices');
  await press('mode-deals');
  await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveAttribute('id', 'view-prices');
  await expect.poll(overlay).toContain('<button data-act="mode-deals" aria-pressed="true">Deals</button>');
  await expect(page.locator('#statusText')).toContainText('Watching for shops');
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fmscan.v1.settings')!).mode)).toBe('deals');
  expect(errors).toEqual([]);
});

test('the deal rules and the chime are set in Settings only, and Clear waits for a deal', async ({ page }) => {
  const { errors } = await open(page);
  // no settings on the Deals view: no rules sentence, no bell
  await expect(page.locator('#view-deals [data-setting]')).toHaveCount(0);
  await expect(page.locator('#view-deals')).not.toContainText('Flag listings');
  await expect(page.locator('#btnClearDeals')).toBeDisabled();

  // set in Settings → Deals, they judge the shop
  await view(page, 'settings');
  await page.fill('#set-discount', '40');
  await page.press('#set-discount', 'Tab');
  await page.fill('#set-minProfit', '12,500');
  await page.press('#set-minProfit', 'Tab');
  await page.fill('#set-fee', '99');
  await page.press('#set-fee', 'Tab');
  await expect(page.locator('#set-fee')).toHaveValue('20');
  await page.uncheck('#set-sound');
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fmscan.v1.settings')!))).toMatchObject({ discount: 40, minProfit: 12500, fee: 20, sound: false });

  // a deal found: Clear clears it, and is greyed again
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await page.fill('#set-discount', '25');
  await page.press('#set-discount', 'Tab');
  await page.fill('#set-minProfit', '3k');
  await page.press('#set-minProfit', 'Tab');
  await view(page, 'deals');
  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  await expect(page.locator('#dealList li')).not.toHaveCount(0);
  await expect(page.locator('#btnClearDeals')).toBeEnabled();
  await page.click('#btnClearDeals');
  await expect(page.locator('#dealList li')).toHaveCount(0);
  await expect(page.locator('#btnClearDeals')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('adds market files up: several at once, and on top of those loaded before', async ({ page }) => {
  const { errors } = await open(page);
  await view(page, 'prices');
  const how = page.locator('details', { hasText: 'How to get the file' }), bulk = page.locator('details', { hasText: 'Add your prices in bulk' });
  await expect(how).not.toHaveAttribute('open');
  await expect(bulk).not.toHaveAttribute('open');
  await expect(page.locator('#pasteBox')).toBeHidden();
  await how.locator('summary').click();
  await expect(how.locator('li')).toHaveCount(3);
  await expect(page.locator('#marketAge')).toHaveText('None loaded yet.');

  // the tracker shows its table a page at a time: two saved pages, picked together, give both
  const file = (name: string, rows: TrackerRow[]) => ({ name, mimeType: 'text/html', buffer: Buffer.from(trackerPage(rows)) });
  await page.setInputFiles('#fileMarket', [
    file('page1.html', [['01472013', 'Dark Guardian', 'Weapons', 120000, 300, '🗡️'], ['01082003', 'Lemona', 'Equips', 21000, 50, '🧤']]),
    file('page2.html', [['01302012', 'Traus', 'Weapons', 55000, 94, '⚔️']]),
    { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<html><body>nothing here</body></html>') },
  ]);
  await expect(page.locator('#marketMsg')).toHaveText('Loaded 2 files: 3 market prices for Windia now, 3 of them added or updated. Skipped notes.html: no price table in it.');
  await expect(page.locator('#marketAge')).toContainText('3 prices for Windia');

  // a third page later adds to them, and its price for an item already there wins
  await page.setInputFiles('#fileMarket', file('page3.html', [['01082003', 'Lemona', 'Equips', 19000, 52, '🧤'], ['02070006', 'Wolbi Throwing Stars', 'Stars', 2499, 7359, '⭐']]));
  await expect(page.locator('#marketMsg')).toHaveText('Loaded 1 file: 4 market prices for Windia now, 2 of them added or updated.');
  // the same file again changes nothing, and says so
  await page.setInputFiles('#fileMarket', file('page3.html', [['01082003', 'Lemona', 'Equips', 19000, 52, '🧤'], ['02070006', 'Wolbi Throwing Stars', 'Stars', 2499, 7359, '⭐']]));
  await expect(page.locator('#marketMsg')).toHaveText('Loaded 1 file: nothing new or changed, still 4 market prices for Windia.');
  await page.fill('#bookSearch', 'lemona');
  await expect(page.locator('#bookTable tbody tr', { hasText: 'Lemona' })).toContainText('19,000');
  // kept for next time
  await page.reload();
  await expect(page.locator('#marketAge')).toContainText('4 prices for Windia');

  // a file with no price table changes nothing
  await page.setInputFiles('#fileMarket', { name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<html></html>') });
  await expect(page.locator('#marketMsg')).toContainText('That page has no price table.');
  await expect(page.locator('#marketAge')).toContainText('4 prices for Windia');

  // your prices in bulk, from behind their disclosure
  await bulk.locator('summary').click();
  await page.fill('#pasteBox', 'Traus, 60k');
  await page.click('#btnPaste');
  await expect(page.locator('#pasteMsg')).toHaveText('Added 1 price.');
  await page.fill('#bookSearch', '');
  await expect(page.locator('#bookTable tbody tr', { hasText: 'Traus' }).locator('input[data-field="manualRef"]')).toHaveValue('60,000');
  expect(errors).toEqual([]);
});

/** How many changes the page's views take while `act` runs: nodes and text written, not attributes. */
async function rewrites(page: Page, act: () => Promise<unknown>): Promise<string[]> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: string[]; obs: MutationObserver };
    w.seen = [];
    w.obs = new MutationObserver((list) => { for (const m of list) w.seen.push((m.target as Element).id || (m.target.parentElement?.closest('[id]')?.id ?? '?')); });
    w.obs.observe(document.querySelector('main')!, { childList: true, subtree: true, characterData: true });
  });
  await act();
  return page.evaluate(() => { const w = window as unknown as { seen: string[]; obs: MutationObserver }; w.obs.disconnect(); return w.seen; });
}

/** Ten checks of the screen, as the ticker makes them. */
const tenChecks = (page: Page) => page.evaluate(async () => {
  const fm = (window as unknown as { FM: { controller: { tick(): Promise<void> } } }).FM;
  for (let i = 0; i < 10; i++) await fm.controller.tick();
});

test('an unchanged screen rewrites nothing, and the price book is kept even when the page goes at once', async ({ page }) => {
  const { errors } = await open(page);
  await page.setInputFiles('#fileMarket', { name: 'tracker.html', mimeType: 'text/html', buffer: Buffer.from(TRACKER) });
  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-list.png'), 0.5), 1440, 900, 400, 200)));
  await expect(page.locator('#shopTable tbody tr')).toHaveCount(6);
  const scans = Number(await page.evaluate(() => document.body.dataset.scans));
  expect(await rewrites(page, () => tenChecks(page))).toEqual([]);
  expect(Number(await page.evaluate(() => document.body.dataset.scans))).toBe(scans + 10);
  // what does change is written: clearing the deals empties their list
  expect(await rewrites(page, () => page.click('#btnClearDeals'))).toContain('dealList');

  // your items, while scanning a tooltip already counted
  await view(page, 'inventory');
  await loadShot(page, screenFile('hover.png', placeOn(loadPng('appraisal/trade-equip.png'), 1440, 900, 100, 100)));
  await page.click('#apScan');
  await expect(page.locator('#apBody tr')).toHaveCount(1);
  expect(await rewrites(page, () => tenChecks(page))).toEqual([]);

  // the sightings were saved a moment after they were read; a reload straight away keeps them too
  await view(page, 'deals');
  await loadShot(page, screenFile('shop.png', placeOn(scaleBy(loadPng('shop-selected-row.png'), 0.5), 1440, 900, 400, 200)));
  await expect(page.locator('#shopTable tbody tr')).toHaveCount(1);
  await page.reload();
  await view(page, 'prices');
  await expect(page.locator('#bookTable tbody')).toContainText('Wolbi Throwing Stars');
  await expect(page.locator('#bookTable tbody')).toContainText('Dark Guardian');
  expect(errors).toEqual([]);
});

test('a backup restores the settings and both marked areas', async ({ page }) => {
  const { errors } = await open(page);
  const shop = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, items = { x: 0.5, y: 0.5, w: 0.2, h: 0.3 };
  await page.evaluate(([a, b]) => {
    localStorage.setItem('fmscan.v1.region.v4', JSON.stringify(a));
    localStorage.setItem('fmscan.v1.region.items', JSON.stringify(b));
  }, [shop, items]);
  await page.reload();
  await view(page, 'settings');
  await expect(page.locator('#view-settings')).toContainText('Market prices are not in the backup.');
  await page.fill('#set-discount', '40');
  await page.press('#set-discount', 'Tab');
  await page.uncheck('#set-sound');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const file = await download.path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup).toMatchObject({ version: 2, settings: { discount: 40, sound: false }, region: shop, itemsRegion: items });

  // everything gone, then the backup back
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await view(page, 'settings');
  await expect(page.locator('#set-discount')).toHaveValue('25');
  await page.setInputFiles('#fileImport', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#dataMsg')).toHaveText('Imported 0 items. Restored your settings and the marked areas.');
  await expect(page.locator('#set-discount')).toHaveValue('40');
  await expect(page.locator('#set-sound')).not.toBeChecked();
  const stored = await page.evaluate(() => ['settings', 'region.v4', 'region.items'].map((k) => JSON.parse(localStorage.getItem(`fmscan.v1.${k}`)!)));
  expect(stored).toEqual([expect.objectContaining({ discount: 40, sound: false }), shop, items]);
  await page.reload();
  await view(page, 'settings');
  await expect(page.locator('#set-discount')).toHaveValue('40');

  // a file that is not a backup changes nothing
  await page.setInputFiles('#fileImport', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('#dataMsg')).toHaveText('That file is not a scanner backup.');
  expect(errors).toEqual([]);
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
