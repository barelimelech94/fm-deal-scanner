import type { Engine } from '../engine';
import type { AppraisalEntry, Region, Settings } from '../lib/types';
import { mergeBackup } from '../pricing/priceBook';
import { makeBackup, readBackup, type BackupRead } from '../store/backup';
import { $, onFile } from './dom';
import { tidyBook } from './pricesView';

const WIPE_LABEL = 'Clear all sightings';

/** What an import did, in words: how many items and lines came in, and what was put back. */
export function importedText(r: BackupRead, items: number, lines: number): string {
  const back = [r.settings ? 'your settings' : '', r.region || r.itemsRegion ? 'the marked areas' : ''].filter(Boolean);
  return `Imported ${items} item${items === 1 ? '' : 's'}.`
    + (lines ? ` Added ${lines} inventory line${lines === 1 ? '' : 's'}.` : '')
    + (back.length ? ` Restored ${back.join(' and ')}.` : '');
}

export interface DataDeps {
  engine: Engine;
  /** the marked areas: the shop's and your items' */
  regions(): { region: Region | null; itemsRegion: Region | null };
  /** your items, for the backup */
  entries(): readonly AppraisalEntry[];
  /** adds your items from a backup; returns how many lines were added */
  importEntries(list: readonly AppraisalEntry[]): number;
  /** puts a backup's settings and marked areas in place */
  restore(r: { settings?: Settings; region?: Region; itemsRegion?: Region }): void;
  saveBook(): void;
  /** prices changed: the shop is judged again and the view drawn */
  changed(): void;
}

/** Settings → Data: the backup out and back in (the price book, the settings, both marked areas and your items), and clearing sightings. */
export class DataGroup {
  private wipeArmed = 0;

  constructor(private readonly d: DataDeps) {}

  say(text: string): void { $('dataMsg').textContent = text; }

  wire(): void {
    $('btnExport').addEventListener('click', () => this.export());
    onFile('fileImport', (f) => this.import(f));
    const wipe = $('btnWipe');
    wipe.addEventListener('click', () => {
      if (Date.now() - this.wipeArmed > 4000) {
        this.wipeArmed = Date.now();
        wipe.textContent = 'Click again to clear';
        setTimeout(() => { wipe.textContent = WIPE_LABEL; }, 4000);
        return;
      }
      for (const it of Object.values(this.d.engine.book.items)) it.s = [];
      this.wipeArmed = 0; wipe.textContent = WIPE_LABEL;
      this.d.saveBook(); this.d.changed();
      this.say('Sightings cleared. Your typed prices stay.');
    });
  }

  private export(): void {
    const e = this.d.engine, { region, itemsRegion } = this.d.regions();
    const body = makeBackup({ book: e.book, settings: e.settings, region, itemsRegion, appraisal: this.d.entries() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = `fm-deal-scanner-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.say('Exported.');
  }

  private async import(f: File): Promise<void> {
    let r: BackupRead;
    try { r = readBackup(await f.text()); } catch (err) {
      this.say(/newer/.test(String(err)) ? 'That backup is from a newer version of the scanner. Update this page first.' : 'That file is not a scanner backup.');
      return;
    }
    const e = this.d.engine;
    const n = mergeBackup(e.book, r.book);
    this.d.restore(r);
    tidyBook(e);
    this.d.saveBook();
    const lines = this.d.importEntries(r.appraisal);
    this.d.changed();
    this.say(importedText(r, n, lines));
  }
}
