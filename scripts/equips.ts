// Fetches the game data's facts about every equip (upgrade slots and base stats) for public/equips.json.
// The logic of scripts/fetch-items.ts, apart from it so it can be tested without maplestory.io.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { ICON_REGION, ICON_VERSION } from '../src/icons';
import type { CatalogSource } from '../src/market/catalog';
import { GAME_STATS, type EquipFile, type EquipRow } from '../src/market/equipFacts';

export const ITEM_API = `https://maplestory.io/api/${ICON_REGION}/${ICON_VERSION}/item`;

/** One row of maplestory.io's item list, with the fields that tell an equip. */
export interface ItemSource extends CatalogSource { typeInfo?: { overallCategory?: string; category?: string } | null }

/** Character parts (faces, hair) are listed as equips too; cash items have no stats worth pricing. */
export const isNonCashEquip = (it: ItemSource): boolean =>
  !it.isCash && it.typeInfo?.overallCategory === 'Equip' && it.typeInfo.category !== 'Character';

/** An equip's row from its /item/{id} answer: `metaInfo.tuc`, and the `metaInfo.inc…` stats without the prefix. */
export function equipRow(id: number, detail: unknown): EquipRow {
  const meta = (detail as { metaInfo?: Record<string, unknown> } | null)?.metaInfo ?? {};
  const stats: Record<string, number> = {};
  for (const key of Object.keys(GAME_STATS)) {
    const v = meta[`inc${key}`];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) stats[key] = v;
  }
  return [id, Number.isInteger(meta.tuc) && (meta.tuc as number) >= 0 ? (meta.tuc as number) : null, stats];
}

const AT_ONCE = 6, RETRIES = 2;
const TRAUS = 1302012;

export interface FetchOptions {
  /** ms to wait before a retry, times the attempt; tests pass 0 */
  pause?: number;
}

/** Every non-cash equip's row, six requests at a time, each tried twice more if it fails. Rows that never arrive are left out. */
export async function fetchEquips(list: readonly ItemSource[], fetcher: typeof fetch, opts: FetchOptions = {}): Promise<{ wanted: number; rows: EquipRow[] }> {
  const ids = list.filter(isNonCashEquip).map((it) => it.id);
  const rows: EquipRow[] = [];
  const one = async (id: number): Promise<void> => {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, (opts.pause ?? 1000) * attempt));
      try {
        const r = await fetcher(`${ITEM_API}/${id}`, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'fm-deal-scanner build' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        rows.push(equipRow(id, await r.json()));
        return;
      } catch { /* tried again, then left out */ }
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, async () => {
    while (next < ids.length) await one(ids[next++]!);
  }));
  return { wanted: ids.length, rows: rows.sort((a, b) => a[0] - b[0]) };
}

/** "7 slots, WAT 60" */
const describeRow = (row: EquipRow | undefined): string =>
  row ? [`${row[1] ?? 'no'} slots`, ...Object.entries(row[2]).map(([k, v]) => `${k} ${v}`)].join(', ') : 'missing';

/**
 * Fetches the equips and writes `out`, unless fewer than 90 % arrive: the existing file is then kept.
 * Returns whether it wrote, and one line saying what happened (with Traus's values, to check the real data by).
 */
export async function writeEquips(list: readonly ItemSource[], fetcher: typeof fetch, out: string, opts: FetchOptions = {}): Promise<{ wrote: boolean; message: string }> {
  const { wanted, rows } = await fetchEquips(list, fetcher, opts);
  const name = relative(process.cwd(), out) || out;
  if (!wanted || rows.length < 0.9 * wanted) {
    const kept = existsSync(out) ? `keeping the existing ${name}` : 'the site will work without equip facts';
    return { wrote: false, message: `got ${rows.length} of ${wanted} equips from ${ITEM_API}; ${kept}` };
  }
  const file: EquipFile = { source: `${ITEM_API}/{id}`, fetched: new Date().toISOString(), items: rows };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file));
  const slotted = rows.filter((r) => r[1] != null).length;
  return { wrote: true, message: `wrote ${rows.length} equips to ${name} (${slotted} with upgrade slots); Traus (${TRAUS}): ${describeRow(rows.find((r) => r[0] === TRAUS))}` };
}
