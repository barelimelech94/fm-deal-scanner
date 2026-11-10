import type { Settings } from '../lib/types';
import { sanitizeValue, settingOf, type SettingDef, type SettingValue } from '../settings/schema';

/** A control a setting is shown in: a number box, a list, a switch (a checkbox), or an on/off button (`aria-pressed`). */
type Control = HTMLInputElement | HTMLSelectElement | HTMLButtonElement;

/**
 * A number as a player types it: digits, with thousands commas only where they belong ("3,000", "1,250,000"), an
 * optional decimal part, and an optional k or m ("5k" is 5,000, "1.5m" is 1,500,000), and a minus for the settings that go below 0; spaces around it are ignored.
 * A decimal part of exactly three digits with no k or m ("3.000") is refused: it reads as thousands written with a
 * dot. Anything else ("12 500", "2,5", "abc", "") is null, so nothing is guessed.
 */
export function parseTypedNumber(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([km])?$/);
  if (!m || (m[3]?.length === 3 && !m[4])) return null;
  const v = parseFloat(`${m[1]}${m[2]!.replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`);
  return m[4] === 'k' ? v * 1e3 : m[4] === 'm' ? v * 1e6 : v;
}

/**
 * What a control holds, as the setting's value: the option for a list or a switch, and for a number, what the box
 * says. A text box (`textBox`) is read strictly (`parseTypedNumber`); a number input's value was already checked by
 * the browser, so it is read as the plain number it is (".5", "0.125", "1e3"). Undefined when it holds nothing
 * usable, such as an empty box. Limits are not applied here.
 */
export function parseInput(def: SettingDef, raw: string, checked: boolean, textBox = false): SettingValue | undefined {
  if (def.kind === 'number') {
    const v = textBox ? parseTypedNumber(raw) : raw.trim() === '' ? null : Number(raw);
    return v != null && Number.isFinite(v) ? v : undefined;
  }
  if (def.kind === 'toggle') return def.options![checked ? 0 : 1]!.value;
  return def.options!.find((o) => String(o.value) === raw)?.value;
}

/**
 * How a control shows a value: the text of a box or a list, and whether a switch is on. A number in a text box
 * (`grouped`) is shown with its thousands separated, as the page writes mesos: "3,000".
 */
export function inputValue(def: SettingDef, v: SettingValue, grouped = false): { value: string; checked: boolean } {
  const value = grouped && def.kind === 'number' && typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
  return { value, checked: def.kind === 'toggle' && v === def.options![0]!.value };
}

const isButton = (el: Control): el is HTMLButtonElement => el instanceof HTMLButtonElement;
const isTextBox = (el: Control): boolean => el instanceof HTMLInputElement && el.type === 'text';

/**
 * Connects every control with `data-setting="<key>"` to that setting: it shows the value, and a change made in it
 * is checked against the setting's limits (`sanitizeValue`) as it is made, stored, and shown in every other
 * control for the same setting. `changed` hears of each setting whose value changed, to save it and act on it.
 */
export class SettingsBinder {
  private readonly controls = new Map<keyof Settings, Control[]>();

  constructor(private readonly settings: Settings, private readonly changed: (key: keyof Settings) => void) {}

  /** Connects the controls under `root`, once each. */
  bind(root: ParentNode): void {
    for (const el of root.querySelectorAll<Control>('[data-setting]')) {
      if (el.dataset.bound) continue;
      el.dataset.bound = '1';
      const key = el.dataset.setting as keyof Settings, def = settingOf(key);
      if (!def) throw new Error(`no setting called ${key}`);
      if (isButton(el) && def.kind !== 'toggle') throw new Error(`${key} is not on or off, so a button cannot show it`);
      const list = this.controls.get(key) ?? [];
      list.push(el);
      this.controls.set(key, list);
      // a button is pressed to turn its setting the other way
      if (isButton(el)) el.addEventListener('click', () => this.take(key, el));
      else el.addEventListener('change', () => this.take(key, el));
    }
    this.show();
  }

  /** Shows the stored value in the controls of `key`, or of every setting. */
  show(key?: keyof Settings): void {
    for (const [k, list] of this.controls) {
      if (key && k !== key) continue;
      const def = settingOf(k), v = this.settings[k];
      for (const el of list) {
        const shown = inputValue(def, v, isTextBox(el));
        if (isButton(el)) el.setAttribute('aria-pressed', String(shown.checked));
        else if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = shown.checked;
        else el.value = shown.value;
      }
    }
  }

  private take(key: keyof Settings, el: Control): void {
    const on = isButton(el) ? el.getAttribute('aria-pressed') !== 'true' : el instanceof HTMLInputElement && el.checked;
    const v = parseInput(settingOf(key), el.value, on, isTextBox(el));
    const was = this.settings[key];
    if (v !== undefined) (this.settings as unknown as Record<string, unknown>)[key] = sanitizeValue(key, v);
    this.show(key);
    if (this.settings[key] !== was) this.changed(key);
  }
}
