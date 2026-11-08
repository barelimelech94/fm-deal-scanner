import { cleanEntries } from '../appraisal/entries';
import { DEFAULT_SETTINGS, type AppraisalData, type MarketData, type PriceBook, type Region, type Settings } from '../lib/types';
import { isPriceBook } from '../pricing/priceBook';

/** Same keys as the single-file scanner, so its Export file imports unchanged. */
const PREFIX = 'fmscan.v1.';

/** JSON in localStorage. Storage can be unavailable or full; reads then fall back, writes report false. */
export class Storage {
  constructor(private readonly ls: globalThis.Storage | null = typeof localStorage === 'undefined' ? null : localStorage) {}

  get<T>(key: string, fallback: T): T {
    try {
      const v = this.ls?.getItem(PREFIX + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch { return fallback; }
  }

  set(key: string, value: unknown): boolean {
    try { this.ls?.setItem(PREFIX + key, JSON.stringify(value)); return !!this.ls; } catch { return false; }
  }

  loadSettings(): Settings { return { ...DEFAULT_SETTINGS, ...this.get<Partial<Settings>>('settings', {}) }; }
  saveSettings(s: Settings): boolean { return this.set('settings', s); }

  loadBook(): PriceBook {
    const b = this.get<unknown>('db', null);
    return isPriceBook(b) ? b : { items: {} };
  }
  saveBook(b: PriceBook): boolean { return this.set('db', b); }

  loadMarket(): MarketData | null {
    const m = this.get<MarketData | null>('market', null);
    return m && Array.isArray(m.items) ? m : null;
  }
  saveMarket(m: MarketData): boolean { return this.set('market', m); }

  loadAppraisal(): AppraisalData {
    const a = this.get<Partial<AppraisalData> | null>('appraisal', null);
    return { entries: cleanEntries(a?.entries) };
  }
  saveAppraisal(a: AppraisalData): boolean { return this.set('appraisal', a); }

  /** the area marked for the appraisal's hovers, apart from the shop's */
  loadItemsRegion(): Region | null { return this.get<Region | null>('region.items', null); }
  saveItemsRegion(r: Region): boolean { return this.set('region.items', r); }

  loadRegion(): Region | null { return this.get<Region | null>('region.v4', null); }
  saveRegion(r: Region): boolean { return this.set('region.v4', r); }
}
