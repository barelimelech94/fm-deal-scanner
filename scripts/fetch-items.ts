// Writes public/items.json: every Classic World item's id and name, from maplestory.io, so items the
// tracker doesn't list (or all of them, before a tracker page is loaded) still get their picture, and
// names read off the screen can be matched against the real ones.
// Then public/equips.json: every equip's upgrade slots and base stats (see scripts/equips.ts).
// Runs at build time in CI. If maplestory.io can't be reached it keeps the files it has, and the site
// then works from tracker data only.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, type CatalogFile } from '../src/market/catalog';
import { ITEM_API, writeEquips, type ItemSource } from './equips';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const out = join(dir, 'items.json');
// a GitHub Actions warning when run there, a plain line elsewhere
const warn = (message: string) => console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}${message}`);

let list: ItemSource[] | null = null;
try {
  const r = await fetch(ITEM_API, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'fm-deal-scanner build' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const got = (await r.json()) as ItemSource[];
  if (!Array.isArray(got) || got.length < 1000) throw new Error(`unexpected item list (${Array.isArray(got) ? got.length : typeof got})`);
  list = got;
  const file: CatalogFile = { source: ITEM_API, fetched: new Date().toISOString(), items: buildCatalog(list) };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file));
  console.log(`wrote ${file.items.length} item names to public/items.json`);
} catch (e) {
  const kept = existsSync(out) ? 'keeping the existing public/items.json' : 'the site will work from tracker data only';
  warn(`could not fetch ${ITEM_API} (${(e as Error).message}); ${kept}`);
}

const equips = join(dir, 'equips.json');
if (list) {
  const r = await writeEquips(list, fetch, equips);
  if (r.wrote) console.log(r.message);
  else warn(r.message);
} else {
  warn(`no item list, so no equip facts; ${existsSync(equips) ? 'keeping the existing public/equips.json' : 'the site will work without them'}`);
}
