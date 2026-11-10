import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ambiguousIds, equipRow, fetchEquips, isNonCashEquip, writeEquips, type ItemSource } from '../scripts/equips';
import { parseEquipFacts, type EquipRow } from '../src/market/equipFacts';

const equip = (id: number, o: Partial<ItemSource> = {}): ItemSource =>
  ({ id, name: `Item ${id}`, isCash: false, typeInfo: { overallCategory: 'Equip', category: 'One-Handed Weapon' }, ...o });
const TRAUS = { id: 1302012, metaInfo: { tuc: 7, incWAT: 60, reqLevel: 40, price: 1 } };

/** maplestory.io as a stand-in: answers /item/{id} from `details`, and counts the requests. */
function fakeApi(details: (id: number, attempt: number) => unknown, delay = 0) {
  const calls = new Map<number, number>();
  let open = 0, mostOpen = 0;
  const fetcher = (async (url: string | URL | Request) => {
    const id = Number(String(url).split('/').pop());
    const attempt = (calls.get(id) ?? 0) + 1;
    calls.set(id, attempt);
    open++; mostOpen = Math.max(mostOpen, open);
    try {
      await new Promise((r) => setTimeout(r, delay));
      const d = details(id, attempt);
      if (d instanceof Error) throw d;
      return d == null ? new Response('busy', { status: 503 }) : Response.json(d);
    } finally { open--; }
  }) as typeof fetch;
  return { fetcher, calls, mostOpen: () => mostOpen };
}

describe('which items are fetched', () => {
  it('takes every equip that is not cash and not a character part', () => {
    expect(isNonCashEquip(equip(1302012))).toBe(true);
    expect(isNonCashEquip(equip(1702048, { isCash: true }))).toBe(false);
    expect(isNonCashEquip(equip(20000, { typeInfo: { overallCategory: 'Equip', category: 'Character' } }))).toBe(false);
    expect(isNonCashEquip(equip(2040801, { typeInfo: { overallCategory: 'Use', category: 'Armor Scroll' } }))).toBe(false);
    expect(isNonCashEquip({ id: 1302000, name: 'Sword' })).toBe(false);
  });
});

describe('one equip from the game data', () => {
  it('keeps its upgrade slots and its base stats, without the inc prefix', () => {
    expect(equipRow(1302012, TRAUS)).toEqual([1302012, 7, { WAT: 60 }]);
    expect(equipRow(1032005, { metaInfo: { tuc: 5, incMDD: 24, incMMP: 5, incCRD: 1, incFly: 3, incPDD: 0, incSTR: '2' } }))
      .toEqual([1032005, 5, { MDD: 24, MMP: 5, CRD: 1 }]);
  });
  it('has no slot count when the game data gives none', () => {
    expect(equipRow(1122000, { metaInfo: { incMDD: 3 } })).toEqual([1122000, null, { MDD: 3 }]);
    expect(equipRow(1122001, {})).toEqual([1122001, null, {}]);
  });
});

describe('equips that share a name', () => {
  it('marks every equip whose name another non-cash equip shares with other slots or base stats', () => {
    const list = [
      equip(1040000, { name: 'Blue Overall' }), equip(1041000, { name: 'Blue Overall' }),   // other base stats
      equip(1060000, { name: 'Brown Pants' }), equip(1061000, { name: 'brown  pants' }),    // other slots
      equip(1302000, { name: 'Sword' }), equip(1302999, { name: 'Sword' }),                 // the same facts: either will do
      equip(1050000, { name: 'Robe' }), equip(1051000, { name: 'Robe' }), equip(1052000, { name: 'Robe' }),   // two agree, one does not
      equip(1442000, { name: 'Axe' }), equip(1702000, { name: 'Axe', isCash: true }),     // a cash one is not an equip with facts
      equip(1072000, { name: 'Boots' }), equip(1073000, { name: 'Boots' }),               // one never arrived: nothing to tell them apart by
    ];
    const rows: EquipRow[] = [
      [1040000, 10, { STR: 1 }], [1041000, 10, { DEX: 1 }],
      [1060000, 7, { PDD: 10 }], [1061000, 5, { PDD: 10 }],
      [1302000, 7, { WAT: 17 }], [1302999, 7, { WAT: 17 }],
      [1050000, 10, { INT: 2 }], [1051000, 10, { INT: 2 }], [1052000, 10, { INT: 3 }],
      [1442000, 7, { WAT: 20 }],
      [1072000, 5, { PDD: 3 }],
    ];
    expect(ambiguousIds(list, rows)).toEqual([1040000, 1041000, 1050000, 1051000, 1052000, 1060000, 1061000]);
    expect(ambiguousIds(list.slice(4, 6), rows)).toEqual([]);
  });
});

describe('fetching the equips', () => {
  it('asks six at a time', async () => {
    const api = fakeApi((id) => ({ metaInfo: { tuc: 7, incWAT: id % 100 } }), 2);
    const list = Array.from({ length: 20 }, (_, i) => equip(1302000 + i));
    const r = await fetchEquips(list, api.fetcher, { pause: 0 });
    expect(r.wanted).toBe(20);
    expect(r.rows).toHaveLength(20);
    expect(api.mostOpen()).toBe(6);
  });

  it('only asks for the equips, sorted by id', async () => {
    const api = fakeApi(() => ({ metaInfo: { tuc: 5 } }));
    const r = await fetchEquips([equip(1302012), equip(1702048, { isCash: true }), { id: 2000000, name: 'Red Potion' }, equip(1032005)], api.fetcher, { pause: 0 });
    expect([...api.calls.keys()].sort()).toEqual([1032005, 1302012]);
    expect(r.rows.map(([id]) => id)).toEqual([1032005, 1302012]);
  });

  it('tries each equip twice more when a request fails', async () => {
    const api = fakeApi((id, attempt) => (id === 1302012 ? (attempt <= 2 ? null : TRAUS) : new TypeError('reset')));
    const r = await fetchEquips([equip(1302012), equip(1302013)], api.fetcher, { pause: 0 });
    expect(r.rows).toEqual([[1302012, 7, { WAT: 60 }]]);
    expect(api.calls.get(1302012)).toBe(3);
    expect(api.calls.get(1302013)).toBe(3);
    // two busy answers for Traus, three resets for the other: every failed request counted, the last one's error kept
    expect(r).toMatchObject({ failed: 5, lastError: 'reset' });
  });
});

describe('writing public/equips.json', () => {
  let dir = '';
  const out = () => join(dir, 'equips.json');
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const setupDir = (existing?: string) => {
    dir = mkdtempSync(join(tmpdir(), 'equips-'));
    if (existing != null) writeFileSync(out(), existing);
  };
  // ten equips, Traus among them
  const list = [equip(1302012), ...Array.from({ length: 9 }, (_, i) => equip(1442000 + i))];

  it('writes every equip that arrived, in the shape the site reads, and says what it got for Traus', async () => {
    setupDir('old');
    const api = fakeApi((id) => (id === 1302012 ? TRAUS : id === 1442008 ? null : { metaInfo: { incWAT: 30 } }));
    const r = await writeEquips(list, api.fetcher, out(), { pause: 0 });
    expect(r.wrote).toBe(true);
    expect(r.message).toMatch(/^wrote 9 equips to .*equips\.json \(1 with upgrade slots, 0 sharing a name with other facts\); Traus \(1302012\): 7 slots, WAT 60$/);
    const file = JSON.parse(readFileSync(out(), 'utf8'));
    expect(file).toMatchObject({ source: 'https://maplestory.io/api/MCW/1/item/{id}', items: expect.any(Array), ambiguous: [] });
    expect(Date.parse(file.fetched)).not.toBeNaN();
    expect(file.items[0]).toEqual([1302012, 7, { WAT: 60 }]);
    expect(file.items[1]).toEqual([1442000, null, { WAT: 30 }]);
    expect(parseEquipFacts(file).get(1302012)).toEqual({ slots: 7, base: { att: 60 } });
  });

  it('says which equips share a name with another that has other facts, so the site can tell', async () => {
    setupDir();
    const api = fakeApi((id) => (id === 1302012 ? TRAUS : { metaInfo: { tuc: 7, incWAT: id === 1442001 ? 31 : 30 } }));
    const shared = list.map((it) => (it.id === 1442000 || it.id === 1442001 ? { ...it, name: 'Axe' } : it));
    const r = await writeEquips(shared, api.fetcher, out(), { pause: 0 });
    expect(r.message).toContain('(10 with upgrade slots, 2 sharing a name with other facts)');
    const file = JSON.parse(readFileSync(out(), 'utf8'));
    expect(file.ambiguous).toEqual([1442000, 1442001]);
    expect(parseEquipFacts(file).get(1442001)).toEqual({ slots: 7, base: { att: 31 }, ambiguous: true });
    expect(parseEquipFacts(file).get(1442002)).toEqual({ slots: 7, base: { att: 30 } });
  });

  it('keeps the existing file when fewer than 90 % arrive', async () => {
    setupDir('old');
    const api = fakeApi((id) => (id >= 1442007 ? null : TRAUS));
    const r = await writeEquips(list, api.fetcher, out(), { pause: 0 });
    expect(r).toEqual({
      wrote: false,
      message: expect.stringMatching(/^got 8 of 10 equips from https:\/\/maplestory\.io\/api\/MCW\/1\/item \(6 requests failed, the last with: HTTP 503\); keeping the existing .*equips\.json$/),
    });
    expect(readFileSync(out(), 'utf8')).toBe('old');
  });

  it('writes none when there is no file to keep, and says so', async () => {
    setupDir();
    const api = fakeApi(() => new TypeError('offline'));
    const r = await writeEquips(list, api.fetcher, out(), { pause: 0 });
    expect(r.wrote).toBe(false);
    expect(r.message).toMatch(/^got 0 of 10 equips .* \(30 requests failed, the last with: offline\); the site will work without equip facts$/);
    expect(existsSync(out())).toBe(false);
  });

  it('names Traus as missing when it did not arrive', async () => {
    setupDir();
    const api = fakeApi((id) => (id === 1302012 ? null : { metaInfo: { tuc: 7 } }));
    const many = [...list, ...Array.from({ length: 10 }, (_, i) => equip(1442100 + i))];
    const r = await writeEquips(many, api.fetcher, out(), { pause: 0 });
    expect(r.message).toMatch(/\(19 with upgrade slots, 0 sharing a name with other facts\); Traus \(1302012\): missing$/);
  });
});
