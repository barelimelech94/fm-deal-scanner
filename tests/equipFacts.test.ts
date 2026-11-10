import { describe, expect, it } from 'vitest';
import { isEquipId, loadEquipFacts, parseEquipFacts } from '../src/market/equipFacts';
import { FACTS } from './helpers/market';

describe('equip facts', () => {
  it('reads upgrade slots and base stats by item id, with the stat labels the tooltips use', () => {
    expect(FACTS.size).toBe(9);
    expect(FACTS.get(1302012)).toEqual({ slots: 7, base: { att: 60 } });
    expect(FACTS.get(1032005)).toEqual({ slots: 5, base: { 'magic def': 24, MP: 5, 'crit dmg': 1 } });
    expect(FACTS.get(1082003)).toEqual({ slots: 5, base: { INT: 1, 'crit rate': 1, 'magic def': 5, 'weapon def': 3 } });
    expect(FACTS.get(1072075)).toEqual({ slots: 5, base: { DEX: 3, avoid: 3, 'weapon def': 18 } });
    expect(FACTS.get(1002082)).toEqual({ slots: 7, base: { DEX: 2, HP: 5, 'weapon def': 24 } });
  });

  it('knows every stat the game data names', () => {
    const all = parseEquipFacts({ items: [[1000000, 7, {
      WAT: 1, MAD: 2, STR: 3, DEX: 4, INT: 5, LUK: 6, ACC: 7, EVA: 8, Speed: 9, Jump: 10, PDD: 11, MDD: 12, CRT: 13, CRD: 14, MHP: 15, MMP: 16,
    }]] });
    expect(all.get(1000000)!.base).toEqual({
      att: 1, 'magic att': 2, STR: 3, DEX: 4, INT: 5, LUK: 6, accuracy: 7, avoid: 8, speed: 9, jump: 10,
      'weapon def': 11, 'magic def': 12, 'crit rate': 13, 'crit dmg': 14, HP: 15, MP: 16,
    });
  });

  it('has no slot count for an item without one, and ignores junk', () => {
    const f = parseEquipFacts({ items: [
      [1122000, null, { MDD: 3 }], [1302000, 7, { WAT: 17, Fly: 2, STR: 'x' }], [1302001, 2.5, {}],
      [2040801, 0, {}], ['no', 7, {}], [1302002, 7, 'junk'], 'junk',
    ] });
    expect([...f]).toEqual([
      [1122000, { slots: null, base: { 'magic def': 3 } }],
      [1302000, { slots: 7, base: { att: 17 } }],
      [1302001, { slots: null, base: {} }],
      [1302002, { slots: 7, base: {} }],
    ]);
    expect(parseEquipFacts(null).size).toBe(0);
    expect(parseEquipFacts({ items: { 1302012: 7 } }).size).toBe(0);
  });

  it('is empty, not an error, when the file is missing or the request fails', async () => {
    const missing = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const offline = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    expect((await loadEquipFacts('equips.json', missing)).size).toBe(0);
    expect((await loadEquipFacts('equips.json', offline)).size).toBe(0);
    const ok = (async () => Response.json({ items: [[1302012, 7, { WAT: 60 }]] })) as typeof fetch;
    expect((await loadEquipFacts('equips.json', ok)).get(1302012)).toEqual({ slots: 7, base: { att: 60 } });
  });

  it('tells an equip by its id', () => {
    expect(isEquipId(1000000)).toBe(true);
    expect(isEquipId(1302012)).toBe(true);
    expect(isEquipId(1999999)).toBe(true);
    expect(isEquipId(999999)).toBe(false);
    expect(isEquipId(2000000)).toBe(false);
    expect(isEquipId(2040801)).toBe(false);
    expect(isEquipId(1302012.5)).toBe(false);
  });
});
