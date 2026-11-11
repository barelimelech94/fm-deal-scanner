import { esc } from '../lib/format';
import type { ScanMode, Settings } from '../lib/types';
import type { ReadTarget } from '../scan/controller';
import { SETTINGS, type SettingDef, type SettingGroup } from '../settings/schema';
import { $, onFile } from './dom';
import { setHtml, setText } from './render';

/** The groups of the Settings view, in order. `state` (what the page remembers) is not shown. */
export const SETTING_GROUPS: readonly { group: Exclude<SettingGroup, 'state'>; title: string; sub?: string }[] = [
  { group: 'deals', title: 'Deals' },
  { group: 'prices', title: 'Prices', sub: 'Used by Deals and Inventory.' },
  { group: 'inventory', title: 'Inventory' },
  { group: 'screen', title: 'Reading the screen' },
];

/** The id of a setting's control in the Settings view. */
export const settingId = (key: keyof Settings): string => `set-${key}`;

/**
 * A setting's control: a number box with its limits, a list of its options, or a switch. Mesos go in a text box,
 * read as a player types them ("5k", "1.5m", "12,500") and shown with their thousands apart, as on the rest of
 * the page; its limits are applied as it is typed.
 */
export function controlHtml(def: SettingDef): string {
  const id = settingId(def.key), attrs = `id="${id}" data-setting="${def.key}" aria-describedby="help-${def.key}"`;
  if (def.kind === 'number' && def.unit === 'mesos') {
    return `<input type="text" inputmode="numeric" autocomplete="off" ${attrs}><span class="unit">mesos</span>`;
  }
  if (def.kind === 'number') {
    return `<input type="number" ${attrs} min="${def.min}" max="${def.max}" step="${def.step}">`
      + `<span class="unit">${esc(def.unit ?? '')}</span>`;
  }
  if (def.kind === 'toggle') return `<input type="checkbox" role="switch" class="switch" ${attrs}><span class="unit"></span>`;
  return `<select ${attrs}>${def.options!.map((o) => `<option value="${esc(String(o.value))}">${esc(o.label)}</option>`).join('')}</select><span class="unit"></span>`;
}

/** One setting: its label and help line, and its control. */
export function settingRowHtml(def: SettingDef): string {
  return `<div class="setting"><div class="setting-text"><label for="${settingId(def.key)}">${esc(def.label)}</label>`
    + `<span class="help" id="help-${def.key}">${esc(def.help)}</span></div><div class="setting-control">${controlHtml(def)}</div></div>`;
}

/** A button that belongs with a setting, with its own help line. */
const extra = (control: string, help: string) =>
  `<div class="setting extra"><div class="setting-text"><span class="help">${help}</span></div><div class="setting-control">${control}<span class="unit"></span></div></div>`;

/** What follows a setting's row: the buttons that go with it. */
const AFTER: Partial<Record<keyof Settings, string>> = {
  appraisalArea: extra('<button class="btn" id="btnMarkItems" disabled>Mark the inventory area</button>', 'Drag a box over your item slots, so hovering anything else adds nothing.'),
  area: extra('<button class="btn" id="btnMarkShop" disabled>Mark the shop area</button>', "Only needed if the scanner can't find the shop list on its own."),
  readStats: extra('<span class="btn filebtn">Test with a screenshot<input type="file" id="fileShot" accept="image/*"></span>', 'Read a saved screenshot instead of the screen.'),
};

/** What closes a group. */
const END: Partial<Record<SettingGroup, string>> = {
  screen: `<details class="trouble" id="trouble"><summary>Troubleshooting</summary>
    <div class="seen" id="seenWrap" hidden><canvas id="seenCanvas" width="160" height="120" aria-label="What the scanner read last"></canvas>
    <p id="seenNote"></p></div>
    <p class="diag" id="diag">Not capturing.</p></details>`,
};

/** What the picture in Troubleshooting is, per mode. */
const SEEN_NOTE: Record<ScanMode, string> = {
  deals: "This is the part of the screen being read. If it doesn't show the item names and prices, use <b>Mark the shop area</b>.",
  inventory: "This is the last tooltip read for your items. If it isn't the item you pointed at, use <b>Mark the inventory area</b>.",
};

const DATA = `<section class="panel quiet" aria-labelledby="hData"><div class="panel-head"><h2 id="hData">Data</h2></div><div class="panel-body">
  <p class="note">Everything is kept in this browser only. Market prices are not in the backup.</p>
  <div class="row">
    <button class="btn" id="btnExport">Export backup</button>
    <span class="btn filebtn">Import backup<input type="file" id="fileImport" accept="application/json,.json"></span>
    <button class="btn ghost" id="btnWipe">Clear all sightings</button>
  </div>
  <p class="note" id="dataMsg"></p>
</div></section>`;

/** The Settings view, generated from the table of settings: one card per group, then Data. */
export function settingsHtml(defs: readonly SettingDef[] = SETTINGS): string {
  return SETTING_GROUPS.map(({ group, title, sub }) => {
    const rows = defs.filter((d) => d.group === group).map((d) => settingRowHtml(d) + (AFTER[d.key] ?? '')).join('');
    return `<section class="panel quiet" aria-labelledby="hSet-${group}"><div class="panel-head"><h2 id="hSet-${group}">${esc(title)}</h2>`
      + (sub ? `<span class="meta">${esc(sub)}</span>` : '') + `</div><div class="panel-body settings">${rows}${END[group] ?? ''}</div></section>`;
  }).join('') + DATA;
}

/** What Troubleshooting says of a running capture. */
export interface CaptureDetails {
  /** what is shared ("monitor" is the whole screen), and its size */
  surface: string;
  size: string;
  framesIn: number;
  /** ms since the last new frame, if one came */
  idle: number | null;
  /** the text reader is loaded */
  reader: boolean;
  /** what the mode reads: the shop list, or your items */
  target: ReadTarget;
}

const TARGET: Record<ReadTarget, string> = {
  'shop-found': 'area found automatically', 'shop-looking': 'area looking for a shop', 'shop-marked': 'area marked by you', 'shop-unset': 'area not set',
  items: 'not reading shops · reading your items anywhere on screen',
  'items-marked': 'not reading shops · reading your items beside the marked area',
  paused: 'not reading shops · your items paused',
};

/** The capture details line in Troubleshooting. */
export function captureDetails(c: CaptureDetails): string {
  const idle = c.idle == null ? null : Math.round(c.idle / 1000);
  return `sharing ${c.surface === 'monitor' ? 'whole screen' : c.surface} ${c.size} · ${c.framesIn} frames received`
    + (idle != null && idle > 5 ? ` · none new for ${idle}s (normal while the screen is still)` : '')
    + ` · text reader ${c.reader ? 'ready' : 'loading'} · ${TARGET[c.target]}`;
}

export interface SettingsViewDeps {
  /** a share or a screenshot is there to mark an area on */
  canScan(): boolean;
  markShop(): void;
  markItems(): void;
  loadShot(f: File): Promise<void>;
  /** the capture details line; empty while not capturing */
  diag(): string;
  /** what the mode's reader read last, for Troubleshooting */
  seen(): (CanvasImageSource & { width: number; height: number }) | null;
  mode(): ScanMode;
}

type Picture = CanvasImageSource & { width: number; height: number };

/** The Settings view: the generated groups, the buttons that go with them, and Troubleshooting. */
export class SettingsView {
  /** the picture drawn in Troubleshooting */
  private drawn: Picture | null = null;

  constructor(root: HTMLElement, private readonly d: SettingsViewDeps) {
    root.innerHTML = settingsHtml();
  }

  wire(): void {
    $('btnMarkShop').addEventListener('click', () => this.d.markShop());
    $('btnMarkItems').addEventListener('click', () => this.d.markItems());
    onFile('fileShot', (f) => this.d.loadShot(f));
    $('trouble').addEventListener('toggle', () => this.renderTrouble());
  }

  /** The buttons that need something to mark an area on, and Troubleshooting. */
  render(): void {
    const can = this.d.canScan();
    for (const id of ['btnMarkShop', 'btnMarkItems']) {
      const b = $<HTMLButtonElement>(id);
      if (b.disabled === can) b.disabled = !can;
    }
    this.renderTrouble();
  }

  /** While Troubleshooting is open: the capture details line, and what the mode's reader read last when that changed. */
  renderTrouble(): void {
    if (!$<HTMLDetailsElement>('trouble').open) return;
    setText($('diag'), this.d.diag() || 'Not capturing.');
    setHtml($('seenNote'), SEEN_NOTE[this.d.mode()]);
    const src = this.d.seen();
    if (src !== this.drawn) this.drawSeen(src);
  }

  /** What the mode's reader read last, small; nothing while it has read nothing. */
  private drawSeen(src: Picture | null): void {
    this.drawn = src;
    if (!src) { $('seenWrap').hidden = true; return; }
    const c = $<HTMLCanvasElement>('seenCanvas'), ctx = c.getContext('2d');
    if (!ctx) return;
    const r = Math.min(160 / src.width, 120 / src.height);
    c.width = Math.max(1, Math.round(src.width * r)); c.height = Math.max(1, Math.round(src.height * r));
    ctx.drawImage(src, 0, 0, c.width, c.height);
    $('seenWrap').hidden = false;
  }
}
