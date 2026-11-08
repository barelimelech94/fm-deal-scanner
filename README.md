# FM Deal Scanner

Reads MapleStory Classic World player shops off your screen and flags listings under their usual price.

**Use it:** https://barelimelech94.github.io/fm-deal-scanner/ (Chrome on a computer)

1. Press **Start capture** and share the MapleStory window.
2. Load market prices once: on [meso.watch](https://meso.watch), once your world's price table has loaded, save the page
   (⌘S) as **Webpage, Complete** and pick that .html file under **Prices and backup**.
3. Open shops in the game. Listings show up within a second; deals chime and land in **Deals this session**.
4. Click a column header on the open shop to order by it: **Profit** puts the most profitable listing first (click again
   to flip), and **Best first** goes back to deals first. The choice is kept for the next shop, and the overlay follows it.
5. **Pop out overlay** keeps a small always-on-top window over the game.

Hover an item in a shop and its stats are read from the tooltip: points above or below the item's base, and
used upgrade slots, move its usual price up or down (tune how much under **Rules**). This needs a usual price
for the item, from the tracker or your own sightings.

Every item gets its picture, and its name is matched, whether or not a tracker page is loaded: the game's own
item list fills in for items the tracker doesn't list.

### NPC prices

The tracker page also lists, for 450 or so items, the price an NPC shop charges for it (the "NPC shop" chip in its Source
column). An NPC usually pays half of that when you sell it the item, so that is what the scanner uses (change the share
under **Rules**, **NPC pays % of its shop price**; 0 ignores NPC prices):

- **Shop:** each listing shows what an NPC pays under its usual price. A listing that costs at least your minimum profit
  less than an NPC pays is a deal on its own, with no market price needed and no sales fee: buy it and sell it to the NPC.
  It chimes and lands in **Deals this session** like any other, saying why.
- **Appraisal:** an item is worth at least what an NPC pays. With no market price that is its price (marked *Rough*, tagged
  *NPC price*); a lower market price is lifted to it. A price you type on a line stays as typed. Throwing stars are left
  out, as they are priced per set.

If you loaded the tracker page before this was added, load it again to get the NPC prices; the market line says when there
are none. The page's NPC prices come from [NiaDB](https://meowdb.com/msclassic), which MesoWatch credits as used with their
permission.

### Appraisal

When someone asks "how much for all?", the **Appraisal** panel adds up a pile of items.

**By hovering.** Press **Start scanning hovers** (with the capture running) and point at your items in the game, one
at a time, in your inventory, a trade window or storage. Each item is added a moment after its tooltip shows: an
equip with its stats (a point above or below base, used upgrade slots), a scroll, potion or Etc item by its name. When
you point at an item and the game also shows the one you are wearing beside it, the left tooltip, the one you hover, is
the one counted. Pointing at the same slot again adds nothing; the same item in another slot joins its line. **Pause**
before moving over things you don't want counted, **Undo last** takes the last one back, and **Mark area** makes the
scanner count only tooltips beside the box you draw, so the chat or the map can't add anything. The pop-out overlay shows
the running total and the same Pause button.

**By typing.** Type or paste item names with a count (`Cape INT Scroll: Lesser x3`). Type a price on any line to use
your own for that line, skip a line you're keeping, and set an **Offer** percentage for taking everything.
**Copy quote** puts a one-line total on the clipboard for the game's chat; **Copy full list** gives every line.
Click a column heading (**Total** puts the most valuable first; click again to flip), or pick from the **Order**
list, which also works on a phone, to order the lines. **As added** goes back to the order they were added in.
Skipped lines and lines with no price stay at the bottom, the copied list follows the same order, and the choice is
kept.

**The number on a stack is not read.** A scroll or potion hovered is added as one stack; type how many you have (the
line is marked until you do). Reading the little number off the slot was tried and left out: it needs the exact slot
under the mouse, and a wrong number would silently skew the total, which is worse than asking. Equips are one each.

Prices come from a mode, and the shop scanner's is only one of them:

- **Cheap** (the shop scanner): your typed price, else the lower of the market price and your own sightings, so only
  real bargains stand out.
- **Fair** (appraisal): your typed price, else the market's typical price.
- **Greedy** (appraisal): your typed price, else the higher of the market's typical price and the upper quarter of your
  own sightings.

Items with a rough price (fewer than 5 sales, or copies that sell very differently) are counted and marked; items with
no price are left out of the total and flagged. The modes live in one table in `src/pricing/evaluate.ts`, so a better
rule for one is a change to one entry.

Hover reading needs the game at its normal size or larger: the text is legible from about one screen pixel per game
pixel, and below that names and stats start to misread. Tooltips are found by their dark blue box, which is blue over
bricks, over black and over bright scenery alike (fixtures: `tests/fixtures/img/appraisal`).

## How it works

Each check takes the newest frame of the share and:

1. **Finds the shop list** by color. List cells are one blue-gray (the selected row orange) at any window size.
   The right edge most cell-colored runs end at is the list's edge; the rows stacked along it, and the columns
   to their left until the icons, are the list. A patch of that color without text in it is scenery.
   `src/vision/locateShop.ts`
2. **Finds a hover tooltip** by the orange bullets that start its stat lines: a vertical column of evenly
   spaced dots. The frame is examined at 1.5 pixels per game pixel (known from the list's width), since the
   bullets are only 3 game pixels across. `src/vision/findTooltip.ts`
3. **Reads the text** with [tesseract.js](https://github.com/naptha/tesseract.js), in a worker, on a crop made
   for it: list text gray from the brightest channel (so the orange row reads like the others), tooltip text
   inverted. `src/vision/preprocess.ts`, `src/scan/scanner.ts`
4. **Parses** "N for X mesos" lines and their names, catching the reader's usual mistakes: letters for digits,
   hidden digits (a wide gap inside a price), sold rows (grey text). `src/listing/parseListing.ts`,
   `src/tooltip/parseTooltip.ts`
5. **Matches** names to your price book's and the tracker's items, then to every item in the game, allowing a
   misread letter or two in long names but never guessing between two items. `src/market/matching.ts`
6. **Judges** each listing against its usual price: your typed price, else the lower of the market price and
   your own sightings. `src/pricing/evaluate.ts`
7. **Confirms** a listing only when two of the last three reads agree, so a frame caught mid-scroll can't invent
   a deal. `src/shop/session.ts`

### How hovers are read (appraisal)

1. **Finds the tooltip** by its box: a see-through dark blue that stays blue-dominant over bricks (violet), black
   (almost black-blue) and bright scenery (lighter blue). Small gaps from text and the picture are bridged, thin blue
   scenery is cut away, and two tooltips side by side (the item you point at, and the one you are wearing) are split
   where the blue dips; the left one is the hovered item. `src/vision/tooltipBox.ts`
2. **Sizes it for the reader** from the item picture's pale square, which is the same size in every tooltip and scales
   with the window, so text lines always reach the reader about 52 pixels apart. `src/vision/tooltipText.ts`
3. **Reads and parses** it: name, type, stat lines (`Weapon Def.: +23 (24 -1)`), upgrade slots. A tooltip with only a name
   and a description (scroll, potion, Etc) counts when its name is a real item's. Names get one more misread letter of
   tolerance than shop listings, never between two items. `src/appraisal/hover.ts`, `src/tooltip/parseTooltip.ts`
4. **Waits for it to stay** for two checks on a live screen, then adds it once per slot. `src/appraisal/hovers.ts`

Everything up to the browser glue is plain TypeScript with no DOM, so it is tested directly.

## Development

```sh
npm install
npm run dev        # http://localhost:5173/fm-deal-scanner/
npm test           # unit tests
npm run bench      # accuracy benchmark: screenshots through the whole scanner (shops and hover tooltips), real text reader
npm run test:e2e   # the built site in Chromium: shop reading at 9 sizes, tooltips, data import, layout
npm run build      # dist/, served under /fm-deal-scanner/
npm run record-hover   # records what the text reader makes of each hover screenshot (tests/fixtures/ocr/hover-*)
npm run items      # public/items.json: every item's id by name, from maplestory.io (CI runs it before building)
```

The test screenshots are in `tests/fixtures/img`. `npm run record-ocr -- <image>` records what the text reader
makes of one, for the parser tests in `tests/fixtures/ocr`.

Every push to `main` runs all of the above in GitHub Actions and publishes `dist/` to GitHub Pages.

## Credits

Item pictures and names: [maplestory.io](https://maplestory.io) (MapleStory Classic World data). Text reading:
[tesseract.js](https://github.com/naptha/tesseract.js). Not affiliated with Nexon.
