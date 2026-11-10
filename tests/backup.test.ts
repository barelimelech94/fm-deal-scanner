import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppraisalEntry, type PriceBook } from '../src/lib/types';
import { makeBackup, readBackup } from '../src/store/backup';

const book: PriceBook = { items: { traus: { name: 'Traus', manualRef: 50000, buyUnder: null, s: [[1, 52000, 1]] } } };
const appraisal: AppraisalEntry[] = [{ id: 'a1', key: 'lemona', name: 'Lemona', qty: 2, price: 21999 }];
const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, itemsRegion = { x: 0.5, y: 0.5, w: 0.2, h: 0.3 };
const settings = { ...DEFAULT_SETTINGS, discount: 40, mode: 'inventory' as const, storeAdjust: 5 };

describe('makeBackup', () => {
  it('writes version 2 with everything in it', () => {
    const j = JSON.parse(makeBackup({ book, settings, region, itemsRegion, appraisal }, Date.UTC(2026, 10, 10)));
    expect(j).toEqual({ version: 2, exported: '2026-11-10T00:00:00.000Z', db: book, settings, region, itemsRegion, appraisal });
  });
});

describe('readBackup', () => {
  it('round-trips a version 2 backup, settings and both areas included', () => {
    const back = readBackup(makeBackup({ book, settings, region, itemsRegion, appraisal }));
    expect(back).toEqual({ book, settings, region, itemsRegion, appraisal });
  });

  it('reads a version 1 backup, as the current version writes it', () => {
    const v1 = JSON.stringify({ version: 1, exported: '2026-11-01T00:00:00.000Z', db: book, settings: { discount: 30 }, region, appraisal });
    const back = readBackup(v1);
    expect(back.book).toEqual(book);
    expect(back.settings).toEqual({ ...DEFAULT_SETTINGS, discount: 30 });
    expect(back.region).toEqual(region);
    expect(back.itemsRegion).toBeUndefined();
    expect(back.appraisal).toEqual(appraisal);
  });

  it('reads the single-file scanner\'s export, which has only the price book', () => {
    const back = readBackup({ db: book });
    expect(back).toEqual({ book, appraisal: [] });
  });

  it('checks the settings and areas it reads', () => {
    const back = readBackup({ version: 2, db: book, settings: { discount: -50, fee: 'x' }, region: { x: 'a' }, itemsRegion: null, appraisal: [{ bad: 1 }, ...appraisal] });
    expect(back.settings).toMatchObject({ discount: 5, fee: DEFAULT_SETTINGS.fee });
    expect(back.region).toBeUndefined();
    expect(back.itemsRegion).toBeUndefined();
    expect(back.appraisal).toEqual(appraisal);
  });

  it('throws on anything that is not a backup', () => {
    for (const bad of ['{broken', 'null', '[]', '{}', JSON.stringify({ version: 2, db: 'no' }), JSON.stringify({ version: 3, db: book }), 42]) {
      expect(() => readBackup(bad), String(bad)).toThrow();
    }
  });
});
