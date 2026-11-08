import { DAY } from '../lib/format';
import type { MarketData, MarketItem } from '../lib/types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const num = (s: string | null | undefined): number | null => {
  const v = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(v) ? v : null;
};
const pct = (el: Element | null): number | null => {
  if (!el) return null;
  const v = parseFloat((el.textContent ?? '').replace(/−/g, '-').replace(/[^\d.-]/g, ''));
  return Number.isFinite(v) ? v / 100 : null;
};

/**
 * The lowest price an NPC shop sells the item at, from its Source chips: "NPC shop|Cutthroat Manny (Kerning City) ·
 * 16,500 mesos each". That is what the NPC charges you, the base for what it would pay for the item.
 */
function npcShopPrice(row: Element): number | null {
  let best: number | null = null;
  for (const chip of Array.from(row.querySelectorAll('[data-src-tip^="NPC shop|"]'))) {
    const m = (chip.getAttribute('data-src-tip') ?? '').match(/(\d[\d,]*)\s*mesos?\s*each/i);
    const v = m ? parseInt(m[1]!.replace(/,/g, ''), 10) : NaN;
    if (Number.isFinite(v) && v > 0 && (best == null || v < best)) best = v;
  }
  return best;
}

/**
 * Reads the price table of a page saved from the MesoWatch tracker ("Webpage, Complete").
 * `savedAt` (the file's modified time) supplies the year the page leaves out.
 */
export function parseTrackerPage(html: string, savedAt: number, parser: DOMParser = new DOMParser()): MarketData {
  const doc = parser.parseFromString(html, 'text/html');
  const items: MarketItem[] = [];
  for (const r of Array.from(doc.querySelectorAll('#rows > tr[data-id]'))) {
    const nameEl = r.querySelector('.item-name');
    const id = r.getAttribute('data-id');
    if (!nameEl || !id) continue;
    const shown = (nameEl.textContent ?? '').trim();
    const n = (nameEl.getAttribute('title') || shown).trim();
    const catEl = r.querySelector('.item-cat');
    const first = catEl?.firstChild;
    const priceEl = r.querySelector('td[data-col="price"] .meso');
    const it: MarketItem = {
      id,
      n,
      c: first && first.nodeType === 3 ? (first.textContent ?? '').trim() : (catEl?.textContent ?? '').trim(),
      p: priceEl ? num(priceEl.getAttribute('title') || priceEl.textContent) : null,
      s: num(r.querySelector('.sales-count')?.textContent) ?? 0,
      d: pct(r.querySelector('.day-pct')),
      w: pct(r.querySelector('.week-pct')),
    };
    if (shown && shown !== n) it.a = shown;
    const f = (r.querySelector('.low-data') ? 'l' : '') + (r.querySelector('.wide-range') ? 'w' : '');
    if (f) it.f = f;
    const fallback = r.querySelector('.item-icon img')?.getAttribute('data-fallback');
    if (fallback) it.e = fallback;
    const npc = npcShopPrice(r);
    if (npc != null) it.npc = npc;
    items.push(it);
  }
  const world = (doc.querySelector('#world span')?.textContent ?? '').trim();
  const upd = (doc.querySelector('#updated')?.getAttribute('title') ?? '')
    .match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  let asOf = savedAt;
  const mo = upd ? MONTHS.indexOf(upd[1]!.toLowerCase()) : -1;
  if (upd && mo >= 0) {
    const y = new Date(savedAt).getFullYear();
    const h = (+upd[3]! % 12) + (/pm/i.test(upd[5]!) ? 12 : 0);
    asOf = new Date(y, mo, +upd[2]!, h, +upd[4]!).getTime();
    // a page saved in early January can carry a December time
    if (asOf > savedAt + DAY) asOf = new Date(y - 1, mo, +upd[2]!, h, +upd[4]!).getTime();
  }
  return { world, updated: upd ? upd[0] : '', asOf, items };
}
