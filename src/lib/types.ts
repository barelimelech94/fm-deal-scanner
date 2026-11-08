// Shared data shapes. Anything persisted keeps the field names the single-file scanner used,
// so its Export file imports here unchanged.

/**
 * How an item's price is read. `cheap` is the shop scanner's: the lowest sensible price, so only
 * real bargains stand out. `fair` and `greedy` are for appraising what you hold: what it is worth,
 * and the most you could reasonably ask.
 */
export type PriceMode = 'cheap' | 'fair' | 'greedy';
export type AppraisalMode = Exclude<PriceMode, 'cheap'>;

/** What the appraisal's table is ordered by. `added` is the default: the order the lines were added in. */
export type AppraisalSortCol = 'added' | 'name' | 'qty' | 'unit' | 'total';

/** What the open shop's table is ordered by. `best` is the default: deals first, then by how far under the usual price. */
export type ShopSortCol = 'best' | 'name' | 'unit' | 'usual' | 'pct' | 'profit';

export interface Settings {
  /** % under the usual price a listing must be to count as a deal */
  discount: number;
  /** mesos a deal must make after the fee */
  minProfit: number;
  /** sales fee in % */
  fee: number;
  /** which statistic of your own sightings is the usual price */
  base: 'median' | 'q25';
  /** sightings needed before your own sightings count */
  minSeen: number;
  /** seconds between screen checks */
  interval: number;
  sound: boolean;
  market: 'on' | 'off';
  /** find the shop list by itself, or use the area you marked */
  area: 'auto' | 'manual';
  readStats: 'on' | 'off';
  /** % of value per stat point above or below base */
  statPct: number;
  /** stat points one used upgrade slot costs */
  slotWorth: number;
  /** % of an NPC shop's price that an NPC pays when you sell it the item; 0 ignores NPC prices */
  npcRatio: number;
  /** how the open shop's listings are ordered, and which way */
  shopSort: ShopSortCol;
  shopSortDir: 1 | -1;
  /** how the appraisal's lines are ordered, and which way */
  appraisalSort: AppraisalSortCol;
  appraisalSortDir: 1 | -1;
  /** which price the appraisal uses */
  appraisalMode: AppraisalMode;
  /** count a hover anywhere, or only near the area you marked */
  appraisalArea: 'any' | 'marked';
  /** % of the appraisal's total you offer or ask for taking everything */
  bulkOffer: number;
}

export const DEFAULT_SETTINGS: Settings = {
  discount: 25, minProfit: 3000, fee: 3, base: 'median', minSeen: 3, interval: 0.8, sound: true,
  market: 'on', area: 'auto', readStats: 'on', statPct: 8, slotWorth: 1,
  npcRatio: 50, shopSort: 'best', shopSortDir: 1, appraisalSort: 'added', appraisalSortDir: 1, appraisalMode: 'fair', appraisalArea: 'any', bulkOffer: 100,
};

/** [time ms, price per unit, units] */
export type Sighting = [number, number, number];

export interface BookItem {
  name: string;
  manualRef: number | null;
  buyUnder: number | null;
  s: Sighting[];
  /** most upgrade slots ever seen remaining on this item */
  maxSlots?: number;
}

export interface PriceBook {
  items: Record<string, BookItem>;
}

/** One row of the price tracker's table. Short field names keep the stored snapshot small. */
export interface MarketItem {
  /** tracker id, e.g. "basil:02040803" or "cash:01702048" */
  id: string;
  /** full name */
  n: string;
  /** category */
  c: string;
  /** typical sale price, null when it has no sales */
  p: number | null;
  /** sales seen */
  s: number;
  /** 24h change as a fraction */
  d: number | null;
  /** 7 day change as a fraction */
  w: number | null;
  /** the tracker's short display name, when it differs */
  a?: string;
  /** flags: l = fewer than 5 sales, w = copies sell for very different prices */
  f?: string;
  /** emoji the tracker shows when it has no icon */
  e?: string;
  /** the lowest price an NPC shop sells it at (what the NPC charges you), when one does */
  npc?: number;
}

export interface MarketData {
  world: string;
  /** "Nov 1, 2:30 PM" as the tracker printed it */
  updated: string;
  /** when the prices were taken, ms */
  asOf: number;
  items: MarketItem[];
}

/** A rectangle as fractions of the frame. */
export interface Region { x: number; y: number; w: number; h: number }

export interface BBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: BBox }
export interface OcrLine { text: string; confidence: number; bbox?: BBox; words?: OcrWord[] }

/** A listing as read off the screen, before it is matched to an item. */
export interface RawListing {
  name: string;
  truncated: boolean;
  /** how sure the reader was about the name line, 0-100 */
  nameConf: number;
  /** vertical center of the row in crop pixels */
  cy: number | null;
  qty: number;
  price: number;
  greyed: boolean;
  /** the price did not read cleanly */
  unsure: boolean;
  /** vertical center of the row as a fraction of the frame */
  fy?: number | null;
}

/** A listing matched to an item. */
export interface Listing extends RawListing {
  key: string;
  known: boolean;
  /** throwing stars and bullets: one item holding a count, priced per set */
  set: boolean;
  /** units the price buys: 1 for a set, else the stack size */
  units: number;
  /** price per unit */
  unit: number;
}

export type Verdict = 'deal' | 'fair' | 'high' | 'new' | 'sold' | 'unsure';
export type UsualSource = 'yours' | 'market' | 'seen';

export interface StatLine { label: string; weight: number; total: number; base: number; delta: number }
export interface TooltipRead {
  key: string;
  name: string;
  type: string;
  stats: StatLine[];
  remaining: number | null;
}
export interface StatValue { mult: number; summary: string; points: number; used: number }

/** One line of an appraisal: an item you hold and how many. */
export interface AppraisalEntry {
  id: string;
  key: string;
  /** as typed or read; the tracker's spelling is used when the item is known */
  name: string;
  /** stack size; for throwing stars and bullets, the number of sets */
  qty: number;
  /** stats read from a hover tooltip: they scale an equip's price */
  tip?: TooltipRead;
  /** a price each typed on this line: it beats every mode */
  price?: number | null;
  /** left out of the total */
  ignored?: boolean;
  /** a stack added by hovering: its size is not known (the number on a slot is not read), so it counts as 1 until typed */
  unsure?: boolean;
}

export interface AppraisalData { entries: AppraisalEntry[] }

export interface Evaluation {
  verdict: Verdict;
  usual: number | null;
  /** the usual price before stats scaled it */
  usualBase: number | null;
  usualSrc: UsualSource | null;
  stats: StatValue | null;
  /** price vs usual, as a fraction: -0.4 is 40% under */
  pct: number | null;
  profit: number | null;
  /** at or under your buy-under price */
  target: boolean;
  /** what an NPC pays for one of them, when its shop price is known (the item's price to you is not involved) */
  npc: number | null;
  /** a deal only because an NPC pays more for it than it costs: no market involved */
  npcFlip: boolean;
  /** why a would-be deal shows as "check" */
  why: string;
}
