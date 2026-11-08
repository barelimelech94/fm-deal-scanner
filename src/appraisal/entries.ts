import type { Engine } from '../engine';
import type { AppraisalEntry, TooltipRead } from '../lib/types';
import { resolveKey } from '../market/matching';
import { statSig } from '../tooltip/statValue';

export const MAX_QTY = 999_999;

/** A whole number of at least 1, kept to a sensible size. */
export const clampQty = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.min(MAX_QTY, Math.floor(n))) : 1);

const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** An entry for a name as typed or read off the screen, filed under the item it means. */
export function entryFor(e: Engine, name: string, qty = 1, tip?: TooltipRead): AppraisalEntry {
  const key = resolveKey({ market: e.market, book: e.book }, name, false);
  const entry: AppraisalEntry = { id: newId(), key, name: e.market.knownName(key) ?? name.trim(), qty: clampQty(qty) };
  if (tip) entry.tip = tip;
  return entry;
}

/** The same item with the same stats and price is one line. */
const sameLine = (a: AppraisalEntry, b: AppraisalEntry): boolean =>
  a.key === b.key && (a.price ?? null) === (b.price ?? null) && !a.ignored === !b.ignored
  && (a.tip ? statSig(a.tip) : '') === (b.tip ? statSig(b.tip) : '');

/** Adds an entry, or its count to the line it repeats. Returns the entry the list now holds. */
export function addEntry(list: AppraisalEntry[], entry: AppraisalEntry): AppraisalEntry {
  const same = list.find((x) => sameLine(x, entry));
  if (same) { same.qty = clampQty(same.qty + entry.qty); return same; }
  list.push(entry);
  return entry;
}

const toQty = (s: string): number => clampQty(parseInt(s.replace(/,/g, ''), 10));

/**
 * "Cape INT Scroll: Lesser x3", "3 x Lemona", "Lemona, 3" or just "Lemona": a name and how many.
 * Lines with no readable name come back as `bad`.
 */
export function parseAppraisalLines(text: string): { ok: { name: string; qty: number }[]; bad: string[] } {
  const ok: { name: string; qty: number }[] = [], bad: string[] = [];
  for (const line of text.split(/\n/).map((s) => s.trim()).filter(Boolean)) {
    let name = line, qty = 1, m: RegExpMatchArray | null;
    if ((m = line.match(/^(\d[\d,]*)\s*[x×*]\s+(.+)$/i))) { qty = toQty(m[1]!); name = m[2]!; }
    else if ((m = line.match(/^(.+?)\s+[x×*]\s*(\d[\d,]*)$/i))) { name = m[1]!; qty = toQty(m[2]!); }
    else if ((m = line.match(/^(.+?)\s*[,;:=\t]\s*(\d[\d,]*)$/))) { name = m[1]!; qty = toQty(m[2]!); }
    name = name.replace(/[\s,;:=\t-]+$/, '').trim();
    if (!/[A-Za-z]{2}/.test(name)) bad.push(line);
    else ok.push({ name, qty });
  }
  return { ok, bad };
}

/** Entries read back from storage or a backup, with anything unusable dropped. */
export function cleanEntries(v: unknown): AppraisalEntry[] {
  if (!Array.isArray(v)) return [];
  const out: AppraisalEntry[] = [];
  for (const x of v as Partial<AppraisalEntry>[]) {
    if (!x || typeof x !== 'object' || typeof x.key !== 'string' || !x.key || typeof x.name !== 'string') continue;
    const entry: AppraisalEntry = { id: typeof x.id === 'string' && x.id ? x.id : newId(), key: x.key, name: x.name, qty: clampQty(Number(x.qty)) };
    if (x.tip && typeof x.tip === 'object' && Array.isArray(x.tip.stats)) entry.tip = x.tip;
    if (typeof x.price === 'number' && x.price > 0) entry.price = x.price;
    if (x.ignored) entry.ignored = true;
    if (x.unsure) entry.unsure = true;
    out.push(entry);
  }
  return out;
}
