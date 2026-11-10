// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';
import { SETTINGS, settingOf } from '../src/settings/schema';
import { inputValue, parseInput, SettingsBinder } from '../src/ui/settingsBind';
import { captureDetails, controlHtml, SETTING_GROUPS, settingId, settingsHtml } from '../src/ui/settingsView';
import { tabAfterKey, viewFromHash, VIEWS } from '../src/ui/shell';

describe('the Settings view', () => {
  const page = () => { document.body.innerHTML = settingsHtml(); return document.body; };

  it('has a control, a label and a help line for every setting but what the page remembers', () => {
    const body = page();
    for (const def of SETTINGS) {
      const el = body.querySelector<HTMLElement>(`#${settingId(def.key)}`);
      if (def.group === 'state') { expect(el, def.key).toBeNull(); continue; }
      expect(el?.dataset.setting, def.key).toBe(def.key);
      expect(body.querySelector(`label[for="${settingId(def.key)}"]`)?.textContent).toBe(def.label);
      expect(body.querySelector(`#help-${def.key}`)?.textContent).toBe(def.help);
    }
  });

  it('puts the groups in order, then Data', () => {
    const titles = [...page().querySelectorAll('section h2')].map((h) => h.textContent);
    expect(titles).toEqual([...SETTING_GROUPS.map((g) => g.title), 'Data']);
    expect(titles).toEqual(['Deals', 'Prices', 'Inventory', 'Reading the screen', 'Data']);
  });

  it('puts each setting in its group, in the order of the table', () => {
    const body = page();
    const keysIn = (title: string) => {
      const sec = [...body.querySelectorAll('section')].find((x) => x.querySelector('h2')?.textContent === title)!;
      return [...sec.querySelectorAll<HTMLElement>('[data-setting]')].map((x) => x.dataset.setting);
    };
    expect(keysIn('Deals')).toEqual(['discount', 'minProfit', 'fee', 'sound']);
    expect(keysIn('Prices')).toEqual(['market', 'base', 'minSeen', 'npcRatio', 'statPct', 'slotWorth']);
    expect(keysIn('Inventory')).toEqual(['appraisalMode', 'storeAdjust', 'bulkOffer', 'appraisalArea']);
    expect(keysIn('Reading the screen')).toEqual(['interval', 'area', 'readStats']);
  });

  it('has the buttons that go with the settings, and Troubleshooting closed', () => {
    const body = page();
    expect(body.querySelector('#btnMarkItems')?.textContent).toBe('Mark the inventory area');
    expect(body.querySelector('#btnMarkShop')?.textContent).toBe('Mark the shop area');
    expect(body.querySelector('#fileShot')).not.toBeNull();
    const trouble = body.querySelector<HTMLDetailsElement>('details#trouble')!;
    expect(trouble.open).toBe(false);
    expect(trouble.querySelector('#seenCanvas')).not.toBeNull();
    expect(trouble.querySelector('#diag')).not.toBeNull();
  });

  it('gives a number its limits and unit, a list its options, and a switch a checkbox', () => {
    expect(controlHtml(settingOf('discount'))).toBe('<input type="number" id="set-discount" data-setting="discount" aria-describedby="help-discount" min="5" max="90" step="1"><span class="unit">%</span>');
    expect(controlHtml(settingOf('minSeen'))).toContain('step="1"><span class="unit"></span>');
    expect(controlHtml(settingOf('base'))).toContain('<option value="median">Middle</option><option value="q25">Lower quarter</option>');
    expect(controlHtml(settingOf('sound'))).toContain('type="checkbox" role="switch"');
  });
});

describe('the capture details in Troubleshooting', () => {
  const c = { surface: 'window', size: '1440×900', framesIn: 42, idle: 1000, reader: true, area: 'found' as const };
  it('says what is shared, how many frames came, the reader and the shop area', () => {
    expect(captureDetails(c)).toBe('sharing window 1440×900 · 42 frames received · text reader ready · area found automatically');
    expect(captureDetails({ ...c, surface: 'monitor', reader: false, area: 'unset' })).toBe('sharing whole screen 1440×900 · 42 frames received · text reader loading · area not set');
  });
  it('says when no new frame came for a while', () => {
    expect(captureDetails({ ...c, idle: 12_400, area: 'marked' })).toContain(' · none new for 12s (normal while the screen is still) · ');
    expect(captureDetails({ ...c, idle: null })).not.toContain('none new');
  });
});

describe('the settings binder', () => {
  it('reads a text box, commas and all, and nothing from an empty one', () => {
    expect(parseInput(settingOf('minProfit'), '12,500', false, true)).toBe(12500);
    expect(parseInput(settingOf('minProfit'), '1,250,000', false, true)).toBe(1_250_000);
    expect(parseInput(settingOf('fee'), ' 2.5 ', false, true)).toBe(2.5);
    expect(parseInput(settingOf('minProfit'), '0', false, true)).toBe(0);
    expect(parseInput(settingOf('storeAdjust'), '-10', false, true)).toBe(-10);
    expect(parseInput(settingOf('fee'), '', false, true)).toBeUndefined();
  });

  it('reads mesos written the short way: 5k, 1.5m', () => {
    expect(parseInput(settingOf('minProfit'), '5k', false, true)).toBe(5000);
    expect(parseInput(settingOf('minProfit'), ' 1.5M ', false, true)).toBe(1_500_000);
    expect(parseInput(settingOf('minProfit'), '2,500k', false, true)).toBe(2_500_000);
  });

  it('reads nothing from a number it cannot be sure of', () => {
    for (const raw of ['12 500', '2,5', '3.000', '3.000k x', 'abc', '1,25', '12,5000', '--5', '5kk', '.5', '5.']) {
      expect(parseInput(settingOf('minProfit'), raw, false, true), raw).toBeUndefined();
    }
  });

  it('reads a list by its option, and a switch by whether it is on', () => {
    expect(parseInput(settingOf('base'), 'q25', false)).toBe('q25');
    expect(parseInput(settingOf('base'), 'nope', false)).toBeUndefined();
    expect(parseInput(settingOf('sound'), 'on', true)).toBe(true);
    expect(parseInput(settingOf('sound'), 'on', false)).toBe(false);
    expect(parseInput(settingOf('readStats'), 'on', false)).toBe('off');
  });

  it('shows a value the way its control holds it', () => {
    expect(inputValue(settingOf('interval'), 0.8)).toEqual({ value: '0.8', checked: false });
    expect(inputValue(settingOf('market'), 'on')).toEqual({ value: 'on', checked: true });
    expect(inputValue(settingOf('sound'), false)).toEqual({ value: 'false', checked: false });
  });

  function bound(html: string) {
    document.body.innerHTML = html;
    const settings: Settings = { ...DEFAULT_SETTINGS };
    const changed: (keyof Settings)[] = [];
    new SettingsBinder(settings, (k) => changed.push(k)).bind(document);
    const type = (sel: string, v: string) => {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
      el.value = v;
      el.dispatchEvent(new Event('change'));
    };
    return { settings, changed, type, val: (sel: string) => document.querySelector<HTMLInputElement>(sel)!.value };
  }

  it('shows the settings, and keeps every control of a setting in step', () => {
    const { settings, changed, type, val } = bound('<input id="a" data-setting="bulkOffer"><select id="b" data-setting="appraisalMode"><option value="fair"></option><option value="greedy"></option></select><input id="c" data-setting="bulkOffer">');
    expect(val('#a')).toBe('100');
    type('#a', '90');
    expect(settings.bulkOffer).toBe(90);
    expect(val('#c')).toBe('90');
    type('#b', 'greedy');
    expect(settings.appraisalMode).toBe('greedy');
    expect(changed).toEqual(['bulkOffer', 'appraisalMode']);
  });

  it('applies the limits as a value is typed', () => {
    const { settings, type, val } = bound('<input id="d" data-setting="discount"><input id="f" data-setting="fee"><input id="i" data-setting="interval">');
    type('#d', '-50');
    type('#f', '500');
    type('#i', '0.01');
    expect(settings).toMatchObject({ discount: 5, fee: 20, interval: 0.4 });
    expect([val('#d'), val('#f'), val('#i')]).toEqual(['5', '20', '0.4']);
  });

  it('applies the limits to mesos written the short way, and leaves the setting alone for what it cannot read', () => {
    const { settings, changed, type, val } = bound('<input type="text" id="p" data-setting="minProfit"><input type="text" id="f" data-setting="fee">');
    type('#p', '5k');
    expect([settings.minProfit, val('#p')]).toEqual([5000, '5,000']);
    type('#f', '5k');
    expect([settings.fee, val('#f')]).toEqual([20, '20']);
    for (const raw of ['12 500', '3.000', 'abc', '']) {
      type('#p', raw);
      expect([settings.minProfit, val('#p')]).toEqual([5000, '5,000']);
    }
    type('#f', '2,5');
    expect([settings.fee, val('#f')]).toEqual([20, '20']);
    expect(changed).toEqual(['minProfit', 'fee']);
  });

  it('reads a number input as the plain number the browser hands over, and applies the limits', () => {
    const { settings, changed, type, val } = bound('<input type="number" id="i" data-setting="interval"><input type="number" id="s" data-setting="statPct"><input type="number" id="p" data-setting="minProfit">');
    type('#i', '.5');
    expect(settings.interval).toBe(0.5);
    type('#i', '0.125');
    expect(settings.interval).toBe(0.4);   // below the limit
    type('#s', '0.500');
    expect(settings.statPct).toBe(0.5);
    type('#p', '1e3');
    expect(settings.minProfit).toBe(1000);
    // empty is refused: the setting stays, and the box shows it again
    type('#p', '');
    expect([settings.minProfit, val('#p')]).toEqual([1000, '1000']);
    expect(changed).toEqual(['interval', 'interval', 'statPct', 'minProfit']);
  });

  it('puts the value back when what was typed is not a number, and tells of no change', () => {
    const { settings, changed, type, val } = bound('<input id="d" data-setting="discount">');
    type('#d', '');
    expect(settings.discount).toBe(25);
    expect(val('#d')).toBe('25');
    type('#d', '25');
    expect(changed).toEqual([]);
  });

  it('shows a list setting as radio buttons, one option each', () => {
    const { settings, changed } = bound('<input type="radio" name="m" id="f" value="fair" data-setting="appraisalMode"><input type="radio" name="m" id="g" value="greedy" data-setting="appraisalMode"><select id="s" data-setting="appraisalMode"><option value="fair"></option><option value="greedy"></option></select>');
    const radio = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
    expect([radio('f').checked, radio('g').checked]).toEqual([true, false]);
    radio('g').checked = true;
    radio('g').dispatchEvent(new Event('change'));
    expect(settings.appraisalMode).toBe('greedy');
    expect(document.querySelector<HTMLSelectElement>('#s')!.value).toBe('greedy');
    expect([radio('f').checked, radio('g').checked, radio('g').value]).toEqual([false, true, 'greedy']);
    expect(changed).toEqual(['appraisalMode']);
  });

  it('reads a plus or a minus in front of a percent typed in a text box', () => {
    const { settings, type, val } = bound('<input type="text" id="a" data-setting="storeAdjust">');
    type('#a', '+5');
    expect([settings.storeAdjust, val('#a')]).toEqual([5, '5']);
    type('#a', '-10');
    expect([settings.storeAdjust, val('#a')]).toEqual([-10, '-10']);
    type('#a', '+-3');
    expect(settings.storeAdjust).toBe(-10);
  });

  it('turns a switch on and off', () => {
    const { settings, changed } = bound('<input type="checkbox" id="s" data-setting="sound">');
    const el = document.querySelector<HTMLInputElement>('#s')!;
    expect(el.checked).toBe(true);
    el.checked = false;
    el.dispatchEvent(new Event('change'));
    expect(settings.sound).toBe(false);
    expect(changed).toEqual(['sound']);
  });

  it('turns a setting on and off from a button, in step with its switch', () => {
    const { settings, changed } = bound('<button id="b" data-setting="sound"></button><input type="checkbox" id="s" data-setting="sound">');
    const b = document.querySelector<HTMLButtonElement>('#b')!, s = document.querySelector<HTMLInputElement>('#s')!;
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.click();
    expect(settings.sound).toBe(false);
    expect([b.getAttribute('aria-pressed'), s.checked]).toEqual(['false', false]);
    s.checked = true;
    s.dispatchEvent(new Event('change'));
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(changed).toEqual(['sound', 'sound']);
  });

  it('shows mesos in a text box with their thousands apart, and reads them back', () => {
    const { settings, type, val } = bound('<input type="text" id="p" data-setting="minProfit"><input type="number" id="q" data-setting="minProfit">');
    expect(val('#p')).toBe('3,000');
    expect(val('#q')).toBe('3000');
    type('#p', '12,500');
    expect(settings.minProfit).toBe(12500);
    expect([val('#p'), val('#q')]).toEqual(['12,500', '12500']);
    expect(inputValue(settingOf('fee'), 2.5, true).value).toBe('2.5');
  });

  it('will not bind a control to a setting that does not exist, nor a button to one that is not on or off', () => {
    expect(() => bound('<input data-setting="nope">')).toThrow('no setting called nope');
    expect(() => bound('<button data-setting="fee"></button>')).toThrow('fee is not on or off');
  });
});

describe('the shell', () => {
  it('reads the view from the address', () => {
    expect(VIEWS).toEqual(['deals', 'inventory', 'prices', 'settings']);
    expect(viewFromHash('#prices')).toBe('prices');
    expect(viewFromHash('settings')).toBe('settings');
    expect(viewFromHash('#nope')).toBeNull();
    expect(viewFromHash('')).toBeNull();
  });

  it('moves along the tabs with the arrow keys, round the ends, and to the ends with Home and End', () => {
    expect(tabAfterKey('ArrowRight', 0, 4)).toBe(1);
    expect(tabAfterKey('ArrowRight', 3, 4)).toBe(0);
    expect(tabAfterKey('ArrowLeft', 0, 4)).toBe(3);
    expect(tabAfterKey('Home', 2, 4)).toBe(0);
    expect(tabAfterKey('End', 0, 4)).toBe(3);
    expect(tabAfterKey('Enter', 0, 4)).toBeNull();
  });
});
