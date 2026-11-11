import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

/**
 * Where a setting is shown in the Settings view. `state` is not shown there: it is what the page remembers
 * (the view, the mode, how tables are ordered), kept and checked like the rest.
 */
export type SettingGroup = 'deals' | 'prices' | 'inventory' | 'screen' | 'state';
/** A number box, a list to pick from, or an on/off switch (whose two options are on, then off). */
export type SettingKind = 'number' | 'select' | 'toggle';
export type SettingValue = string | number | boolean;

export interface SettingOption { value: SettingValue; label: string }

/** One setting: what it is called, what it does, and the values it may take. */
export interface SettingDef {
  key: keyof Settings;
  group: SettingGroup;
  label: string;
  /** one line saying what it does */
  help: string;
  kind: SettingKind;
  /** for numbers: the limits a value is clamped to, the step of the box, and the unit after it */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** for lists and switches: the values allowed */
  options?: readonly SettingOption[];
}

const ON_OFF: readonly SettingOption[] = [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];
const DIR: readonly SettingOption[] = [{ value: 1, label: 'Ascending' }, { value: -1, label: 'Descending' }];
const num = (min: number, max: number, step: number, unit = '') => ({ kind: 'number' as const, min, max, step, unit });

/**
 * Every setting, once. The Settings view is generated from this table, and every value is checked against it
 * when typed and when loaded, so a setting cannot exist without a group, a label, a help line and limits.
 */
export const SETTINGS: readonly SettingDef[] = [
  // Deals
  { key: 'discount', group: 'deals', label: 'Discount needed', help: 'How far under its usual price a listing must be to count as a deal.', ...num(5, 90, 1, '%') },
  { key: 'minProfit', group: 'deals', label: 'Minimum profit', help: 'Mesos a deal must make after the sales fee.', ...num(0, 100_000_000, 100, 'mesos') },
  { key: 'fee', group: 'deals', label: 'Sales fee', help: 'What selling it again costs, taken off the profit.', ...num(0, 20, 0.5, '%') },
  { key: 'sound', group: 'deals', label: 'Chime on a deal', help: 'Play a sound when a new deal is found.', kind: 'toggle', options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
  // Prices, used by Deals and Inventory
  { key: 'market', group: 'prices', label: 'Use market prices', help: "Judge items by the price tracker's prices, not only your own.", kind: 'toggle', options: ON_OFF },
  {
    key: 'base', group: 'prices', label: 'Usual price from your sightings', help: 'Which of your own sightings is the usual price when there is no market price.', kind: 'select',
    options: [{ value: 'median', label: 'Middle' }, { value: 'q25', label: 'Lower quarter' }],
  },
  { key: 'minSeen', group: 'prices', label: 'Sightings to trust', help: 'How many of your own sightings an item needs before they count.', ...num(1, 50, 1) },
  { key: 'npcRatio', group: 'prices', label: 'NPC pays', help: 'The share of its NPC shop price an NPC pays you for an item. 0 ignores NPC prices.', ...num(0, 100, 1, '% of its shop price') },
  { key: 'statPct', group: 'prices', label: 'Each stat point', help: 'How much a point above or below base moves the price. An estimate.', ...num(0, 50, 0.5, '% of value') },
  { key: 'slotWorth', group: 'prices', label: 'Each used upgrade slot', help: 'How many stat points a used upgrade slot costs. An estimate.', ...num(0, 5, 0.1, 'stat points') },
  // Inventory
  {
    key: 'appraisalMode', group: 'inventory', label: 'Price items at', help: "Market is the tracker's typical price; Asking is the higher of that and what shops ask.", kind: 'select',
    options: [{ value: 'fair', label: 'Market' }, { value: 'greedy', label: 'Asking' }],
  },
  { key: 'storeAdjust', group: 'inventory', label: 'List at', help: 'What to put an item in your store at, against its price.', ...num(-50, 100, 1, '%') },
  {
    key: 'appraisalArea', group: 'inventory', label: 'Count hovers', help: 'Count every hovered item, or only those beside the area you marked.', kind: 'select',
    options: [{ value: 'any', label: 'Anywhere' }, { value: 'marked', label: 'Only near the marked area' }],
  },
  // Reading the screen
  { key: 'interval', group: 'screen', label: 'Check every', help: 'How often the screen is read.', ...num(0.4, 5, 0.1, 's') },
  {
    key: 'area', group: 'screen', label: 'Shop area', help: 'Find the shop list by itself, or read only the area you marked.', kind: 'select',
    options: [{ value: 'auto', label: 'Find it' }, { value: 'manual', label: 'Use the marked one' }],
  },
  { key: 'readStats', group: 'screen', label: 'Read stats on hover', help: "Read a hovered shop item's stats, so they move its price.", kind: 'toggle', options: ON_OFF },
  // Remembered by the page
  {
    key: 'mode', group: 'state', label: 'Scan mode', help: 'What the scanner looks for: shops, or your own items.', kind: 'select',
    options: [{ value: 'deals', label: 'Deals' }, { value: 'inventory', label: 'Inventory' }],
  },
  {
    key: 'view', group: 'state', label: 'View', help: 'The view shown last.', kind: 'select',
    options: [{ value: 'deals', label: 'Deals' }, { value: 'inventory', label: 'Inventory' }, { value: 'prices', label: 'Prices' }, { value: 'settings', label: 'Settings' }],
  },
  {
    key: 'shopSort', group: 'state', label: 'Order the shop by', help: "The open shop's column its listings are ordered by.", kind: 'select',
    options: [
      { value: 'best', label: 'Best first' }, { value: 'name', label: 'Item' }, { value: 'unit', label: 'Each' },
      { value: 'usual', label: 'Usual' }, { value: 'pct', label: 'vs usual' }, { value: 'profit', label: 'Profit' },
    ],
  },
  { key: 'shopSortDir', group: 'state', label: 'Shop order direction', help: 'Which way the open shop is ordered.', kind: 'select', options: DIR },
];

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** The table's entry for a setting. */
export const settingOf = (key: keyof Settings): SettingDef => BY_KEY.get(key)!;

/** One value checked against its entry: a number clamped to its limits, anything not allowed its default. */
export function sanitizeValue<K extends keyof Settings>(key: K, v: unknown): Settings[K] {
  const def = BY_KEY.get(key), fallback = DEFAULT_SETTINGS[key];
  if (!def) return fallback;
  if (def.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.min(def.max!, Math.max(def.min!, v)) as Settings[K];
  }
  return (def.options!.some((o) => o.value === v) ? v : fallback) as Settings[K];
}

/**
 * Settings as stored or imported, made whole and safe: every setting present, numbers clamped to their limits,
 * a value that is not one of a setting's options replaced by its default, unknown keys dropped. Old settings
 * keep their names and meaning, so whatever an earlier version saved still loads.
 */
export function sanitizeSettings(partial: unknown): Settings {
  const src = partial && typeof partial === 'object' ? (partial as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SETTINGS } as Record<keyof Settings, unknown>;
  for (const def of SETTINGS) if (def.key in src) out[def.key] = sanitizeValue(def.key, src[def.key]);
  return out as Settings;
}
