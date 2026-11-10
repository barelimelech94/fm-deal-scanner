# Facelift plan: two tools, one home for settings, fewer guesses

Planned 2026-11-10 against `main` @ 88eac28. Work happens on the `facelift` branch.

The scanner does two jobs on one long page: finding **deals** in other players' shops, and valuing **your own
items** (what you are worth, and what to list each item at in your store). Today both run at once, share one
status line and one settings panel, and get in each other's way. This plan separates them, gives every setting
one home, fixes the bugs found in the audit, and replaces the guesses that game data can answer.

How the screen is read (finding the shop list, finding tooltips, text reading) is **not** changed here. The
accuracy benchmark (`npm run bench`) must report the same numbers before and after.

## 1. What is wrong today

### 1.1 Layout

- One page, 2,700 px tall on a desktop and 5,300 px on a phone: Open shop, Deals, Rules, Appraisal, Price book,
  Prices and backup. The two features are stacked, not separated.
- Settings live in five places: the header (Sound), Rules (12 fields), the Appraisal toolbar (4), the Price book
  (per item) and Prices and backup. Rules mixes three unrelated things: what counts as a deal, how any item is
  priced (used by both features), and how the screen is read.
- Two buttons called "Mark area" mark different things. The header's capture buttons look like they belong to
  deals but serve both features.
- A first-time user is told to press Start capture. Nothing says market prices are needed first, and the
  loader for them is at the bottom of the page.
- Long instructions are printed inline in three panels. The "what the scanner sees" thumbnail sits permanently
  between the deal banner and the shop table.
- Words: "Appraisal", "kinds", "Fair/Greedy", "Count hovers", "quote" describe a bulk-sale calculator. The
  feature's purpose is "what am I worth" and "price my store".

### 1.2 Bugs (each reproduced)

| # | Bug | Evidence |
|---|-----|----------|
| 1 | A listing that sells while the shop is open stays in the table as a live deal, next to its "Sold" twin. | `ShopSession`: read `[A]`, then `[A greyed]` → rows `A:deal`, `A:sold`. |
| 2 | The previous shop's listings stay in the table when the next shop shares one identical listing with it, or has a single listing, and was opened after one empty read. | `ShopSession`: shop `[A, B]`, one empty read, shop `[C]` → rows `A, B, C`. |
| 3 | The count of identical listings only ever goes up. Three copies, two bought: still "×3". | `existing.count = Math.max(...)`. |
| 4 | Hovering an equip while scanning your items reads the tooltip twice (two text-reading passes) and shows it in the Open shop panel as "Hovered … Not in this shop's list". | Measured in the built site: 2 passes per hover; `#hoverLine` visible. |
| 5 | Every table that has rows is rebuilt on every check (every 0.8 s), also when nothing changed. Clicks on row buttons can be lost, and it wastes work. | 10 checks of an unchanged screen → the appraisal table rewritten 10 times. |
| 6 | Settings accept any number and store it: −50 % discount, 500 % fee, a check every 0.01 s. | Typed in Rules; stored as typed. |
| 7 | Import ignores the settings in a backup. Export leaves out the area marked for items. A "restore" does not restore. | Export → clear → import: discount back to the default. |
| 8 | Loading market prices replaces all of them. The tracker shows its table a page at a time, so only the last saved page's items have a price. | `setMarket` builds a new index from the one file. |
| 9 | With your inventory on screen and no shop, the status says "no shop window found … use Mark shop area". | Status text is written for deals only. |

### 1.3 Guesses that data can replace

maplestory.io's Classic World data (already used for item names and pictures) has, per equip, its upgrade slots
(`metaInfo.tuc`) and its base stats (`metaInfo.incWAT`, `incMDD`, …). Checked against the test screenshots:
Traus `incWAT 60`, `tuc 7`; Weighted Earrings `incMDD 22`, `incEVA 1`, `tuc 5`; Red Cross Earrings `incMDD 24`,
`incMMP 5`, `incCRD 1`, `tuc 5`. There are 1,207 non-cash equips.

| Guess today | Replace with |
|-------------|--------------|
| Upgrade slots from the tooltip's "Type:" text (7 / 5 / 10 by a word list), raised by the most ever seen on a copy. | The item's `tuc`. |
| Base stats from the tooltip's "(60 −2)" text, with rules for when the base reads as letters or goes missing. | The item's base stats. The tooltip then only has to give the total. |
| "It is an equip if its tooltip has stat lines." | The item's id: 1,000,000–1,999,999 is an equip. |
| Read stats make any "rough" market price trusted. | They settle only "copies sell for very different prices" (the difference is the stats). "Fewer than 5 sales" stays rough. |
| Sold / new-shop / count rules in the shop (bugs 1–3). | Stated rules, below. |

Stays a rule of thumb, on purpose: how much a stat point is worth (the tracker has no prices by stats). It keeps
its two settings and is labelled an estimate.

## 2. Target

### 2.1 Structure

One page, four views, switched by tabs in a slim bar that stays on top. The address keeps the view
(`#deals`, `#inventory`, `#prices`, `#settings`); the last one is remembered.

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ (M) FM Deal Scanner   [ Deals ] [ Inventory ] [ Prices ]      ● Watching for shops  [Stop]  [Overlay]  [⚙] │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Deals**: other players' shops. Nothing about your own items.
- **Inventory**: your items. Nothing about shops.
- **Prices**: the data both use: market prices, your own prices, buy-under targets.
- **Settings** (gear): every setting, grouped, each with one line saying what it does.
- **Capture control** (in the bar, shared): Start capture when idle; when running, one line saying what it is
  doing and a Stop button. Errors (capture blocked, cancelled) show in a bar under it with the existing texts.

### 2.2 One thing at a time: scan modes

`settings.mode` is `'deals'` or `'inventory'`. Opening the Deals or the Inventory view sets it; Prices and
Settings leave it alone. The capture control and the overlay name the mode.

- `deals`: find the shop list, read it, read shop tooltips (if "Read stats" is on). Hovers are never added to
  your items.
- `inventory`: read hovered tooltips into your items, only while **Scan my items** is on. The shop is not
  looked for; switching to this mode closes the open shop. Leaving the Inventory view for Deals pauses scanning.

One tooltip is read once, by the mode's own reader (fixes bug 4 and bug 9).

### 2.3 Deals view

```
┌ Get started (only until all three are done) ──────────────────────────────────────┐
│ ✓ 1 Load market prices      2 Start capture [Start capture]      3 Open a shop    │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Open shop ───────────── 6 listings, 1 deal ┐  ┌ Deals found ─────────── 🔔  [Clear] ┐
│ Flag listings [25]% under usual that make  │  │ 9:30  Dark Guardian        +36,401  │
│ [3,000] mesos after a [3]% fee.            │  │ …                                   │
│ ┌ DEAL  Dark Guardian          +36,401 ┐   │  └─────────────────────────────────────┘
│ └──────────────────────────────────────┘   │
│ Hovered: Traus, −2 att … worth about 46,200│
│ Item            Each   Usual  vs usual  Profit │
│ …                                          │
└────────────────────────────────────────────┘
```

- The three deal rules sit where they are used, as one sentence with three inputs. They are the same settings
  as in Settings → Deals; changing either changes both.
- The bell turns the chime on and off (same setting as Settings → Deals).
- No thumbnail, no long text. When capture runs and no shop is found for a while, one line offers "Not finding
  the shop? Mark its area" (opens the marking dialog).

### 2.4 Inventory view

```
┌ Inventory ─────────────────────────────────────────────────────────────────────────┐
│ Worth            In your store        12 items · 2 need a count · 1 has no price   │
│ 1,234,567        1,296,000                                                         │
│ [▶ Scan my items]  [Undo]  [+ Add by name]                                 [Clear] │
│ Added Lemona                                                                       │
│ Item                 Qty   Market each   List at   Total                           │
│ Lemona                1       21,000      21,999    21,000   Priced      ⊘ ×       │
│ Red Potion          [ 1]          40          42        40   Type count  ⊘ ×       │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Store prices ───────────────────────────┐  ┌ ▸ Sell everything at once ───────────┐
│ Price items at  (•) Market  ( ) Asking  │  │ Offer [100]% of the worth            │
│ List at [ +5 ]% of that                 │  │ [Copy quote] [Copy full list]        │
└─────────────────────────────────────────┘  └──────────────────────────────────────┘
```

- **Worth** is the sum at the chosen price (Market = today's "Fair", Asking = today's "Greedy"). **In your
  store** is the sum of the List at prices.
- **List at** is what to type when you put the item in your store: a price typed on the line, else the item's
  price moved by "List at ±%". Typing in the List at box sets the line's price (the existing per-line price).
- The row of the item hovered last is highlighted and scrolled into view. The overlay shows that item with its
  List at price in large type, so setting up a store is: hover the item, read the price, type it.
- "N need a count" filters to the stacks whose count was not typed; Enter in a Qty box moves to the next one.
- "Add by name" opens the existing paste box. "Sell everything at once" holds the offer percentage and the two
  copy buttons, closed by default.
- First use shows the steps: 1 Load market prices, 2 Start capture, 3 Press Scan my items and point at your
  items.

### 2.5 Prices view

- **Market prices**: how many, for which world, how old (warning when old), `[Update market prices]`. The file
  picker takes several files at once, and a load **adds to** what is there (fixes bug 8). "How to get the
  file" is a closed disclosure with the three steps.
- **Price book**: search, table, Your price, Buy under (as today). "Add your prices in bulk" (the paste box) is
  a closed disclosure. The legend is one line.

### 2.6 Settings view

Generated from one table in code (`src/settings/schema.ts`), so a setting cannot exist without a group, a
label, a help line and limits. Values are clamped to their limits when typed and when loaded (fixes bug 6).

| Group | Settings |
|-------|----------|
| **Deals** | Discount needed (5–90 %). Minimum profit (mesos). Sales fee (0–20 %). Chime on a deal. |
| **Prices** (used by Deals and Inventory) | Use market prices. Usual price from your sightings (middle / lower quarter). Sightings to trust (1–50). NPC pays % of its shop price (0–100). Each stat point, % of value (0–50). Each used upgrade slot, in stat points (0–5). |
| **Inventory** | Price items at (Market / Asking). List at ±% (−50 to +100). Offer for everything (1–300 %). Count hovers anywhere / only near the marked area, with `[Mark the inventory area]`. |
| **Reading the screen** | Check every (0.4–5 s). Shop area: find it / use the marked one, with `[Mark the shop area]`. Read stats on hover. `[Test with a screenshot]`. Troubleshooting (closed): what the scanner sees, and the capture details line. |
| **Data** | Export backup, Import backup (settings and both marked areas included, fixes bug 7). Clear all sightings. "Everything is kept in this browser only. Market prices are not in the backup." |

### 2.7 Where every control goes

| Today | New home |
|-------|----------|
| Start capture / Stop, status pill | Top bar capture control |
| Pop out overlay | Top bar |
| Mark shop area, Test with a screenshot, capture details line, "what the scanner sees" | Settings → Reading the screen |
| Sound | Bell on Deals found; Settings → Deals |
| Rules: Discount, Minimum profit, Sales fee | Deals rule sentence; Settings → Deals |
| Rules: Market prices, Usual from sightings, Sightings to trust, NPC pays, Each stat point, Each used slot | Settings → Prices |
| Rules: Shop area, Read stats on hover, Check every | Settings → Reading the screen |
| Appraisal: Count hovers, Mark area | Settings → Inventory |
| Appraisal: Prices, Offer % | Inventory: Store prices, Sell everything at once |
| Appraisal: Order list | Column headings; a small Sort control only on phones, where headings are hidden |
| Appraisal: Add items box | Inventory: Add by name |
| Price book, Market prices, Your prices | Prices view |
| Backup, Clear all sightings | Settings → Data |

### 2.8 Overlay

Follows the mode, with a two-way switch (Deals | Inventory) in its header that also switches the page.

- Deals: newest deal, hovered item, best eight rows (as today).
- Inventory: the item hovered last (picture, name, **List at** in large type, market price and sales under it),
  the running Worth, Scan / Pause.

### 2.9 Look

Keep the colours, the two typefaces and light/dark. Change hierarchy and density: a sticky bar, one main card
per view, secondary cards quieter, help text inside closed disclosures, no paragraph longer than two lines on
a working view. Works at 390 px wide without sideways scrolling: tabs stay one row, cards stack, tables become
cards as the appraisal table does today.

## 3. Work

Two phases, one commit per numbered item, tests with each.

### Phase A: logic and data (no change to the page)

**A1. Shop session rules** (`src/shop/session.ts`), bugs 1–3.
- A greyed row replaces the live record with the same item, quantity and price: when the sold twin's count
  rises by k between reads, the live record's count drops by k, and the record goes when it reaches 0.
- After one or more reads with no list, the next confirmed list is the same shop only if at least one of its
  rows matches a row that was visible in the last read before the gap, at the same position (within half a
  row). Otherwise it is a new shop: rows cleared, `since` reset. (The deal log is unaffected.)
- Keep the two-of-three confirmation and `covered()` as they are.

**A2. Market prices add up** (`src/market/mergeMarket.ts`), bug 8.
`mergeMarket(prev: MarketData | null, next: MarketData): MarketData`. Same world (ignoring case), or no world
on either: union by item `id`; `next`'s rows win; rows only in `prev` are kept with `t` = their own `t`, else
`prev.asOf`. `asOf`/`updated` come from `next`. A different world: `next` alone. `MarketItem` gains optional
`t` (when its price was taken, when older than `asOf`). `marketTip` says the item's own age when it has `t`.

**A3. Backup** (`src/store/backup.ts`), bug 7.
`makeBackup({ book, settings, region, itemsRegion, appraisal })` writes version 2. `readBackup(json)` returns
`{ book, settings?, region?, itemsRegion?, appraisal }` for versions 1 and 2, settings passed through
`sanitizeSettings` (A4). Throws on anything that is not a backup.

**A4. Settings table** (`src/settings/schema.ts`), bug 6.
One entry per setting: `key`, `group`, `label`, `help`, `kind` (`number` | `select` | `toggle`), `min`, `max`,
`step`, `unit`, `options`. `sanitizeSettings(partial): Settings` fills defaults and clamps; `Storage.loadSettings`
uses it. New settings: `mode: 'deals' | 'inventory'` (default `deals`), `view` (default `deals`),
`storeAdjust: number` (default 0, −50 to 100). Existing keys keep their names and meaning, so stored settings
and old backups still load.

**A5. Equip facts from game data** (the first two rows of 1.3).
- `scripts/fetch-items.ts`: after the item list, fetch `/item/{id}` for every non-cash equip
  (`typeInfo.overallCategory === 'Equip'`, `category !== 'Character'`; about 1,200), six at a time, two retries,
  and write `public/equips.json`: `{ source, fetched, items: [[id, tuc, { WAT: 60, … }], …] }` with the `inc`
  prefix dropped. If fewer than 90 % arrive, keep the existing file. In CI, cache `public/items.json` and
  `public/equips.json` (`actions/cache`, key: hash of the script + ISO week), so a push does not refetch.
- `src/market/equipFacts.ts`: `EquipFact { slots: number | null; base: Partial<Record<StatLabel, number>> }`,
  `parseEquipFacts(json)`, `loadEquipFacts(url)`, `isEquipId(id)`. Game keys to the labels in
  `tooltip/parseTooltip.ts`: `WAT` att, `MAD` magic att, `STR`, `DEX`, `INT`, `LUK`, `ACC` accuracy, `EVA` avoid,
  `Speed` speed, `Jump` jump, `PDD` weapon def, `MDD` magic def, `CRT` crit rate, `CRD` crit dmg, `MHP` HP,
  `MMP` MP.
- `Engine` gains `facts` (an empty map by default, so everything works without the file).
- `statValue` takes the item's fact: slots are `fact.slots`; each stat line's base is the fact's (0 when the
  item has no such base stat) and its delta is total − base. When the tooltip's own "(base ±n)" was read and
  base + n disagrees with the total, base + n is the total (the game printed it). With no fact, today's
  behaviour stays as the fallback.
- Test data: `tests/fixtures/equips.sample.json` with the real values for Traus 1302012 (7; WAT 60), Axe Pole
  Arm 1442005 (7; WAT 60), Weighted Earrings 1032002 (5; MDD 22, EVA 1), Red Cross Earrings 1032005 (5; MDD 24,
  MMP 5, CRD 1), Yellow Square 1032003 (5; MDD 22, CRD 1), Dark Guardian 1472013 (7; WAT 26, CRD 1), Lemona
  1082003 (5; INT 1, CRT 1, MDD 5, PDD 3), Bronze Chain Boots 1072075 (5; DEX 3, EVA 3, PDD 18), Green Bamboo
  Hat 1002082 (7; DEX 2, MHP 5, PDD 24). Include the case the old rules could not read: a base that came out as
  letters.

**A6. Equip or stack by id** (`src/appraisal/hovers.ts`): an item whose id is known is an equip when
`isEquipId(id)`; the stat-lines test stays only for items with no known id.

**A7. Rough stays rough** (`src/pricing/evaluate.ts`, `src/appraisal/appraise.ts`): read stats clear the
"copies sell for very different prices" flag only.

**A8. The hover event names its line** (`src/appraisal/hovers.ts`): `HoverEvent` gains `entryId` for `added`,
`again` and `fixed`, so the page and the overlay can show the item hovered last.

### Phase B: the facelift

**B1. Scan controller** (`src/scan/controller.ts`, no DOM): owns capture, ticker, reader, both scanners and the
mode; one `tick()`; tells listeners what changed (shop, hover, status). Implements 2.2. `ShopSession` and the
hover collector expose a `version` that rises on any change.

**B2. Shell and views.** `index.html` becomes the bar plus four `<section>` views. `src/app.ts` shrinks to
wiring; views in `src/ui/`: `shell.ts` (tabs, address, mode), `captureBar.ts`, `dealsView.ts`,
`inventoryView.ts` (from `appraisalPanel.ts`), `pricesView.ts`, `settingsView.ts` (generated from the schema),
`setupSteps.ts`. One binder (`src/ui/settingsBind.ts`) connects every `[data-setting]` control to the setting,
so the Deals sentence, the Store prices card and the Settings view stay in step.

**B3. Draw only what changed** (bug 5). `src/ui/render.ts`: `setHtml(el, html)` writes only when the string
differs. A view draws when its data's version changed and only while it is the visible view (and once when
shown). The overlay the same. Saving the price book waits a second after the last change.

**B4. Deals view** as 2.3, with its Get started steps.

**B5. Inventory view** as 2.4: Worth and In your store, List at, Store prices, Sell everything at once, Add by
name, the need-a-count filter and Enter-to-next, the highlighted last-hovered row, its Get started steps.
`listPrice(line, storeAdjust)` lives beside `appraise` and is unit tested.

**B6. Prices view** as 2.5: several files at once through `mergeMarket`; disclosures.

**B7. Settings view** as 2.6, including Data with `makeBackup` / `readBackup`.

**B8. Overlay** as 2.8.

**B9. Load `equips.json`** at start, beside the catalog; pass facts to the engine.

**B10. Tests and docs.** The end-to-end suite keeps every scenario it has, moved to the new views, and gains:
tabs and the remembered view; one text-reading pass per inventory hover and nothing in Deals; a setting changed
in one place shows in the other; limits; backup round trip with settings; two market files adding up; a sold
listing leaving the table; the Get started steps. README rewritten for the new structure, shorter.

**B11. Visual pass** as 2.9, checked on screenshots at 1400 and 390 px wide, light and dark.

## 4. Rules for the work

- Branch `facelift`. Never commit to or push `main` (pushing `main` deploys the site).
- No new runtime dependencies and no framework: plain TypeScript and the DOM, as now.
- Storage keeps its `fmscan.v1.` keys. Data saved by today's version must load.
- Pure logic stays free of the DOM and is unit tested; the page is covered end to end.
- Before a phase is done: `npm run check`, `npm run bench` and `npm run test:e2e` pass, and the benchmark's
  numbers are the same as on `main`.
- Element ids the tests use stay where the element survives (`shopTable`, `dealBanner`, `apBody`, `bookTable`,
  `fileMarket`, `fileShot`, `fileImport`, `statusText`, `body[data-scans]`, `window.FM`).
- Words on the page: plain and short, as now. "Inventory", not "Appraisal"; "items", not "kinds".
- Keyboard and screen readers: real tabs (`role="tablist"`), visible focus, status as a live region.

## 5. Not in this round

- **Automatic market-price refresh.** Settings → Prices is its home. It needs MesoWatch's reply first: what
  they allowed, and how a page on github.io may fetch it.
- **Reading a stack's count off the slot.** It stays typed; 2.4 makes typing it quicker.
- **What an NPC pays, from game data.** Each item has a `metaInfo.price`; whether that is the NPC's buying
  price in Classic World needs one check in the game before it replaces the "half the shop price" rule.
- **One tooltip finder instead of two.** With one mode at a time they no longer run together; merging them is
  a vision change and belongs with a benchmark run of its own.
