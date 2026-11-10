import type { Settings } from '../lib/types';
import { sanitizeValue, settingOf, type SettingDef, type SettingValue } from '../settings/schema';

/** A control a setting is shown in: a number box, a list, or a switch (a checkbox). */
type Control = HTMLInputElement | HTMLSelectElement;

/**
 * What a control holds, as the setting's value: a number for a number box (commas allowed), the option for a
 * list or a switch. Undefined when it holds nothing usable, such as an empty box. Limits are not applied here.
 */
export function parseInput(def: SettingDef, raw: string, checked: boolean): SettingValue | undefined {
  if (def.kind === 'number') {
    const v = parseFloat(raw.replace(/,/g, '').trim());
    return Number.isFinite(v) ? v : undefined;
  }
  if (def.kind === 'toggle') return def.options![checked ? 0 : 1]!.value;
  return def.options!.find((o) => String(o.value) === raw)?.value;
}

/** How a control shows a value: the text of a box or a list, and whether a switch is on. */
export function inputValue(def: SettingDef, v: SettingValue): { value: string; checked: boolean } {
  return { value: String(v), checked: def.kind === 'toggle' && v === def.options![0]!.value };
}

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
      const key = el.dataset.setting as keyof Settings;
      if (!settingOf(key)) throw new Error(`no setting called ${key}`);
      const list = this.controls.get(key) ?? [];
      list.push(el);
      this.controls.set(key, list);
      el.addEventListener('change', () => this.take(key, el));
    }
    this.show();
  }

  /** Shows the stored value in the controls of `key`, or of every setting. */
  show(key?: keyof Settings): void {
    for (const [k, list] of this.controls) {
      if (key && k !== key) continue;
      const shown = inputValue(settingOf(k), this.settings[k]);
      for (const el of list) {
        if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = shown.checked;
        else el.value = shown.value;
      }
    }
  }

  private take(key: keyof Settings, el: Control): void {
    const v = parseInput(settingOf(key), el.value, el instanceof HTMLInputElement && el.checked);
    const was = this.settings[key];
    if (v !== undefined) (this.settings as unknown as Record<string, unknown>)[key] = sanitizeValue(key, v);
    this.show(key);
    if (this.settings[key] !== was) this.changed(key);
  }
}
