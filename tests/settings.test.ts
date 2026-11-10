// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import { SETTINGS, sanitizeSettings, settingOf } from '../src/settings/schema';
import { Storage } from '../src/store/storage';

describe('the settings table', () => {
  it('has one entry per setting, each with a label, a help line and a group', () => {
    expect(SETTINGS.map((s) => s.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    for (const s of SETTINGS) {
      expect(s.label, s.key).toBeTruthy();
      expect(s.help, s.key).toBeTruthy();
      expect(s.group, s.key).toBeTruthy();
      if (s.kind === 'number') {
        expect(s.min, s.key).toBeTypeOf('number');
        expect(s.max, s.key).toBeTypeOf('number');
        expect(s.step, s.key).toBeGreaterThan(0);
        const d = DEFAULT_SETTINGS[s.key] as number;
        expect(d >= s.min! && d <= s.max!, `${s.key} default in its limits`).toBe(true);
      } else {
        expect(s.options?.map((o) => o.value), s.key).toContain(DEFAULT_SETTINGS[s.key]);
        if (s.kind === 'toggle') expect(s.options, s.key).toHaveLength(2);
      }
    }
  });

  it('has the limits the plan gives', () => {
    expect(settingOf('discount')).toMatchObject({ group: 'deals', min: 5, max: 90, unit: '%' });
    expect(settingOf('fee')).toMatchObject({ group: 'deals', min: 0, max: 20 });
    expect(settingOf('minSeen')).toMatchObject({ group: 'prices', min: 1, max: 50 });
    expect(settingOf('npcRatio')).toMatchObject({ group: 'prices', min: 0, max: 100 });
    expect(settingOf('statPct')).toMatchObject({ group: 'prices', min: 0, max: 50 });
    expect(settingOf('slotWorth')).toMatchObject({ group: 'prices', min: 0, max: 5 });
    expect(settingOf('storeAdjust')).toMatchObject({ group: 'inventory', min: -50, max: 100 });
    expect(settingOf('bulkOffer')).toMatchObject({ group: 'inventory', min: 1, max: 300 });
    expect(settingOf('interval')).toMatchObject({ group: 'screen', min: 0.4, max: 5, unit: 's' });
  });

  it('has the new settings with their defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: 'deals', view: 'deals', storeAdjust: 0 });
    expect(settingOf('mode').options!.map((o) => o.value)).toEqual(['deals', 'inventory']);
    expect(settingOf('view').options!.map((o) => o.value)).toEqual(['deals', 'inventory', 'prices', 'settings']);
  });
});

describe('sanitizeSettings', () => {
  it('fills in the defaults', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps good values', () => {
    const good = { ...DEFAULT_SETTINGS, discount: 30, base: 'q25', sound: false, market: 'off', mode: 'inventory', view: 'prices', storeAdjust: -10, shopSortDir: -1 } as const;
    expect(sanitizeSettings(good)).toEqual(good);
  });

  it('clamps numbers to their limits', () => {
    const s = sanitizeSettings({ discount: -50, fee: 500, interval: 0.01, minProfit: -1, storeAdjust: 1000, bulkOffer: 0 });
    expect(s).toMatchObject({ discount: 5, fee: 20, interval: 0.4, minProfit: 0, storeAdjust: 100, bulkOffer: 1 });
  });

  it('puts back the default for what is not a value of the setting', () => {
    const s = sanitizeSettings({ discount: 'lots', fee: NaN, base: 'mean', sound: 'yes', market: true, mode: 'shop', view: 'other', shopSort: 'price', appraisalSortDir: 0 } as never);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('drops keys it does not know, and does not change what it was given', () => {
    const given = { discount: 500, old: 1 };
    const s = sanitizeSettings(given);
    expect('old' in s).toBe(false);
    expect(given).toEqual({ discount: 500, old: 1 });
  });
});

describe('Storage.loadSettings', () => {
  it('clamps what was stored', () => {
    localStorage.clear();
    localStorage.setItem('fmscan.v1.settings', JSON.stringify({ discount: -50, fee: 500, interval: 0.01 }));
    expect(new Storage().loadSettings()).toMatchObject({ discount: 5, fee: 20, interval: 0.4, mode: 'deals' });
  });

  it('loads settings saved before the new ones existed', () => {
    localStorage.clear();
    const old = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete old.mode; delete old.view; delete old.storeAdjust;
    localStorage.setItem('fmscan.v1.settings', JSON.stringify({ ...old, discount: 40 }));
    expect(new Storage().loadSettings()).toEqual({ ...DEFAULT_SETTINGS, discount: 40 });
  });
});
