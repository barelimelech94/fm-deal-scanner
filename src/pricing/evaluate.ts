import type { Engine } from '../engine';
import type { BookItem, Evaluation, Listing, MarketItem, PriceMode, Settings, TooltipRead, UsualSource } from '../lib/types';
import { isRough, npcSellPrice } from '../market/marketIndex';
import { statValue } from '../tooltip/statValue';
import { sightingStats, type SightingStats } from './priceBook';

export interface Usual { value: number; src: UsualSource; rough: boolean }

/** What a mode reads its price from: the tracker's price for the item and the stats of your own sightings. */
interface Inputs { mk: MarketItem | null; st: SightingStats; settings: Settings }

const marketOf = ({ mk, settings }: Inputs): number | null => (settings.market !== 'off' && mk?.p ? mk.p : null);
/** A sighting statistic, once there are enough sightings to trust it. */
const seenOf = ({ st, settings }: Inputs, v: number | null): number | null => (st.n >= settings.minSeen ? v : null);
const fromMarket = ({ mk }: Inputs, value: number): Usual => ({ value, src: 'market', rough: isRough(mk) });
const fromSeen = (value: number): Usual => ({ value, src: 'seen', rough: false });

/**
 * The ways a price can be read. Each takes the same inputs and returns a price and where it came from,
 * so a better rule is a change to one entry here. A price you typed for the item beats all of them.
 */
const MODES: Record<PriceMode, (i: Inputs) => Usual | null> = {
  /** The lower (safer) of the market price and your own sightings: what the shop scanner judges against. */
  cheap(i) {
    const seen = seenOf(i, i.settings.base === 'q25' ? i.st.q25 : i.st.median), mkt = marketOf(i);
    if (mkt != null && (seen == null || mkt <= seen)) return fromMarket(i, mkt);
    return seen != null ? fromSeen(seen) : null;
  },
  /** The tracker's typical price; your sightings' middle only where the tracker has none. */
  fair(i) {
    const mkt = marketOf(i);
    if (mkt != null) return fromMarket(i, mkt);
    const seen = seenOf(i, i.st.median);
    return seen != null ? fromSeen(seen) : null;
  },
  /** The higher of the tracker's typical price and the upper quarter of your own sightings (what shops ask). */
  greedy(i) {
    const mkt = marketOf(i), up = seenOf(i, i.st.q75);
    if (mkt != null && (up == null || mkt >= up)) return fromMarket(i, mkt);
    return up != null ? fromSeen(up) : null;
  },
};

/** Your typed price wins; otherwise the price the mode reads. The shop scanner uses `cheap`. */
export function usualPrice(
  it: BookItem | null | undefined, mk: MarketItem | null, settings: Settings, now: number, mode: PriceMode = 'cheap',
): Usual | null {
  if (it?.manualRef) return { value: it.manualRef, src: 'yours', rough: false };
  return MODES[mode]({ mk, st: sightingStats(it, now), settings });
}

export type Judged = Listing & { tip?: TooltipRead };

export function evaluate(e: Engine, row: Judged): Evaluation {
  const it = e.book.items[row.key];
  const mk = e.market.get(row.key);
  let u = usualPrice(it, mk, e.settings, e.now());
  // stats read from the hover tooltip scale the usual price, and settle a "rough" market price
  const stats = row.tip ? statValue(row.tip, { statPct: e.settings.statPct, slotWorth: e.settings.slotWorth, maxSlotsSeen: it?.maxSlots }) : null;
  const usualBase = u && stats ? u.value : null;
  if (u && stats) u = { ...u, value: u.value * stats.mult, rough: false };
  // an NPC pays the same for any copy, stats or not, and takes any stack; sets (stars) are priced as a whole
  const npcEach = row.set ? null : npcSellPrice(mk, e.settings.npcRatio);
  const out: Evaluation = {
    verdict: 'new', usual: u?.value ?? null, usualBase, usualSrc: u?.src ?? null, stats,
    pct: null, profit: null, target: false, why: '', npc: npcEach, npcFlip: false,
  };
  if (row.greyed) return { ...out, verdict: 'sold' };
  if (u) {
    out.pct = row.unit / u.value - 1;
    out.profit = Math.round(u.value * row.units * (1 - e.settings.fee / 100) - row.price);
    if (out.pct <= -e.settings.discount / 100 && out.profit >= e.settings.minProfit) out.verdict = 'deal';
    else if (out.pct >= 0.15) out.verdict = 'high';
    else out.verdict = 'fair';
  }
  if (out.verdict === 'deal' && u?.rough) {
    out.verdict = 'unsure';
    out.why = (mk?.f ?? '').includes('w')
      ? 'Copies of this item sell for very different prices. Check its stats before buying.'
      : 'The market price comes from fewer than 5 sales.';
  }
  if (it?.buyUnder && row.unit <= it.buyUnder) { out.verdict = 'deal'; out.target = true; out.why = ''; }
  // Buying it to sell straight to an NPC needs no market and no sales fee: if that pays enough, it is a deal
  if (npcEach != null && !row.unsure) {
    const npcProfit = Math.round(npcEach * row.units - row.price);
    if (npcProfit >= e.settings.minProfit && out.verdict !== 'deal') { out.verdict = 'deal'; out.npcFlip = true; out.profit = npcProfit; out.why = ''; }
  }
  if (row.unsure && out.verdict === 'deal') { out.verdict = 'unsure'; out.why = "The price didn't read cleanly."; }
  return out;
}
