import { cleanEntries } from '../appraisal/entries';
import type { AppraisalEntry, PriceBook, Region, Settings } from '../lib/types';
import { isPriceBook } from '../pricing/priceBook';
import { sanitizeSettings } from '../settings/schema';

/** The backup file's version. 1 had no area marked for items; the single-file scanner's export had no version. */
export const BACKUP_VERSION = 2;

/** What a backup holds. Market prices are not in it: they come from the tracker page. */
export interface BackupData {
  book: PriceBook;
  settings: Settings;
  region: Region | null;
  itemsRegion: Region | null;
  appraisal: readonly AppraisalEntry[];
}

/** What a backup read back gives: the parts it had, checked. */
export interface BackupRead {
  book: PriceBook;
  settings?: Settings;
  region?: Region;
  itemsRegion?: Region;
  appraisal: AppraisalEntry[];
}

/** The backup file's text (version 2): the price book, the settings, both marked areas and your items. */
export function makeBackup(d: BackupData, now: number = Date.now()): string {
  return JSON.stringify({
    version: BACKUP_VERSION, exported: new Date(now).toISOString(), db: d.book, settings: d.settings,
    region: d.region, itemsRegion: d.itemsRegion, appraisal: d.appraisal,
  }, null, 1);
}

const isRegion = (v: unknown): v is Region => !!v && typeof v === 'object'
  && (['x', 'y', 'w', 'h'] as const).every((k) => typeof (v as Region)[k] === 'number' && Number.isFinite((v as Region)[k]));

/**
 * A backup file read back, as text or parsed: version 2, version 1, or the single-file scanner's export. The
 * settings are checked like stored ones (`sanitizeSettings`), areas that are not areas and unusable lines are
 * dropped. Throws on anything that is not a backup, or one from a newer version.
 */
export function readBackup(json: unknown): BackupRead {
  const j = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown> | null;
  if (!j || typeof j !== 'object' || Array.isArray(j) || !isPriceBook(j.db)) throw new Error('not a scanner backup');
  if (j.version != null && j.version !== 1 && j.version !== BACKUP_VERSION) throw new Error(`backup version ${String(j.version)} is newer than this scanner`);
  const out: BackupRead = { book: j.db, appraisal: cleanEntries(j.appraisal) };
  if (j.settings && typeof j.settings === 'object') out.settings = sanitizeSettings(j.settings);
  if (isRegion(j.region)) out.region = j.region;
  if (isRegion(j.itemsRegion)) out.itemsRegion = j.itemsRegion;
  return out;
}
