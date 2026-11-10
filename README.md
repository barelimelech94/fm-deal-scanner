# FM Deal Scanner

Reads MapleStory Classic World off your screen and does two jobs:

- **Deals:** reads the player shops and hired merchants you open, and flags listings under their usual price.
- **Inventory:** reads the tooltips of your own items as you point at them, says what they are worth, and what to
  list each at in your store.

**Use it:** https://barelimelech94.github.io/fm-deal-scanner/ (Chrome on a computer; it needs Chrome's screen capture)

## How to use it

A bar across the top holds the tabs of the four views, **Start capture** and **Overlay**. Press **Start capture** and
share the MapleStory window.

**Deals** is where you start. Its **Get started** steps send you to load market prices, start capture and open a shop.
Open shops in the game: listings show within a second, a deal chimes (the bell turns that off) and lands in **Deals
found**. The sentence above the table holds the deal rules (how far under usual, the profit after the sales fee); click
a column heading to order the shop by it. Point at a listing and its stats are read off the tooltip: points above or
below the item's base and used upgrade slots move its usual price. If the shop isn't found after a while, the view
offers to mark its area.

**Prices** keeps the **Price book**: every item you have seen, its usual price, your own price (used instead of the
market's) and a **Buy under** price (a listing at or below it is a deal whatever the usual price). The market prices are
loaded here too.

**Inventory** values your items. Press **Scan my items** and point at them one at a time, in your inventory, a trade
window or storage; each is added a moment after its tooltip shows. The same slot counts once; the same item in another
slot joins its line. **Pause** before moving over things you don't want counted, **Undo** takes the last one back, or
add items by name. The number on a stack is not read, so type it: **N need a count** shows just those lines, and Enter
moves to the next. You get **Worth** (at **Market** or **Asking** prices) and **In your store**: what to type in your
store for each item, **List at** a percent above or below that price; **Copy store prices** copies them all. **Sell
everything at once** makes an offer for the lot.

**Settings** has every setting, in step with the same controls on the views, and **Data**: export and import a backup,
or clear all sightings. **Troubleshooting** shows what the scanner reads.

**Overlay** (Chrome 116+) floats a small window over the game: in Deals the newest deal and the best listings, in
Inventory the item you pointed at last with its List at price. Its **Deals | Inventory** switch sets the mode.

## Where things are kept

In this browser only (its local storage): the price book, your items, your settings and the marked areas. A backup
from **Settings → Data** carries all of them, but not the market prices. Nothing you keep is sent anywhere.

## How prices get in

- **Market prices:** on [meso.watch](https://meso.watch), wait until your world's price table has loaded, save the page
  (⌘S) as **Webpage, Complete**, and pick the .html file under **Prices → Update market prices**. The tracker shows its
  table a page at a time: pick several saved pages at once, or one after another, and they add up.
- **Your sightings:** every listing read in a shop goes into the price book. With enough of them, a usual price lower
  than the market's is used.
- **Your own prices:** type one on an item in the price book, or paste many at once under **Add your prices in bulk**.
  A price typed in a line's List at box in Inventory is that line's own.
- **NPC prices:** the tracker page also gives, for some items, what an NPC shop charges; an NPC pays you half of that
  (**NPC pays** in Settings; 0 turns it off). A listing that costs at least your minimum profit less than an NPC pays is
  a deal on its own, and in Inventory an item is worth at least what an NPC pays. They come from
  [NiaDB](https://meowdb.com/msclassic), which MesoWatch credits as used with their permission.
- **Game data:** every item's picture and name, and every equip's upgrade slots and base stats, come from the game's own
  data, so stats are measured against the item's real base.

## What is an estimate

- The usual price is the market's typical sale (or your sightings, or your price); a price from fewer than 5 sales, or
  for an item whose copies sell for very different prices, is marked **Rough**. Stats read off a copy settle the second.
- What stats are worth is a rule of thumb (the tracker has no prices by stats): each point and each used slot moves the
  price by an amount you set in Settings → Prices.
- Text reading makes mistakes. A listing counts only once two of the last three reads agree, and hover reading needs the
  game at its normal size or larger.

## Build it

```sh
npm install
npm run dev        # http://localhost:5173/fm-deal-scanner/
npm run check      # typecheck, unit tests, build
npm run bench      # accuracy benchmark: test screenshots through the whole scanner, with the real text reader
npm run test:e2e   # the built site in Chromium, end to end
npm run items      # public/items.json and public/equips.json from maplestory.io (CI does this before building)
```

The test screenshots are in `tests/fixtures/img`; `npm run record-ocr -- <image>` and `npm run record-hover` record
what the text reader makes of them, for the parser tests. Plain TypeScript, no framework: the logic (finding and reading
the shop and the tooltips, matching, pricing, the shop's and your items' rules) has no DOM and is tested directly, and
the page is covered end to end. Every push to `main` runs all of the above in GitHub Actions and publishes `dist/` to
GitHub Pages.

## Credits

Item pictures, names and equip data: [maplestory.io](https://maplestory.io) (MapleStory Classic World data). Text
reading: [tesseract.js](https://github.com/naptha/tesseract.js). Not affiliated with Nexon.
