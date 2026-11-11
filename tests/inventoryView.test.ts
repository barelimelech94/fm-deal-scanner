// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TooltipRead } from '../src/lib/types';
import { Storage } from '../src/store/storage';
import { InventoryView } from '../src/ui/inventoryView';
import { hoverEngine } from './helpers/hover';

/** The page's own Inventory view. */
const INVENTORY = readFileSync('index.html', 'utf8').match(/<section class="view two" id="view-inventory"[\s\S]*?\n {2}<\/section>\n/)![0];

const memory = (): globalThis.Storage => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as globalThis.Storage;
};
const tip = (name: string): TooltipRead => ({ key: name.toLowerCase(), name, type: '', remaining: null, stats: [] });

describe('InventoryView', () => {
  const setup = () => {
    const view = new InventoryView({
      engine: hoverEngine(), store: new Storage(memory()), failed: new Set(), region: () => null, setScanning() {}, paused: () => false,
      shown: () => true, version: () => '', capturing: () => false, openPrices() {}, overlay() {},
    });
    view.wire();
    view.render({ force: true });
    return view;
  };
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const add = (text: string) => { $<HTMLTextAreaElement>('apAdd').value = text; $('apAddBtn').click(); };
  const names = () => [...document.querySelectorAll('#apBody .nm-n')].map((n) => n.textContent);
  const box = (name: string, field: 'qty' | 'price') =>
    [...document.querySelectorAll('#apBody tr')].find((tr) => tr.querySelector('.nm-n')!.textContent === name)!.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)!;
  /** A hover read in the game: the view hears of it as the page tells it. */
  const hover = (view: InventoryView, name: string, x: number) => view.showEvent(view.collector.ingest(tip(name), { x, y: 100, pitch: 48 }));
  const enter = (el: HTMLElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const settle = () => new Promise((r) => setTimeout(r));

  beforeEach(() => { document.body.innerHTML = INVENTORY; });
  afterEach(() => { vi.useRealTimers(); });

  it('leaves the box you are typing in alone when a hover comes in, and shows the hover once you leave it', async () => {
    const view = setup();
    add('Red Potion x5');
    const listAt = box('Red Potion', 'price');
    listAt.focus();
    listAt.value = '12';   // typed, not put on the line yet
    hover(view, 'Leaf', 100);
    expect($('apHint').textContent).toContain('Added Leaf');   // said at once
    expect(box('Red Potion', 'price')).toBe(listAt);
    expect(listAt.value).toBe('12');
    expect(document.activeElement).toBe(listAt);
    expect(names()).toEqual(['Red Potion']);
    // the price typed is put on its line, and the table shows the hover too
    listAt.dispatchEvent(new Event('change', { bubbles: true }));
    expect(names()).toEqual(['Red Potion', 'Leaf']);
    expect(box('Red Potion', 'price').value).toBe('12');
    expect(document.querySelector('#apBody tr.last .nm-n')!.textContent).toBe('Leaf');

    // a box left without a change: the table follows once focus has gone
    const count = box('Red Potion', 'qty');
    count.focus();
    hover(view, 'Lemona', 400);
    expect(names()).toEqual(['Red Potion', 'Leaf']);
    count.blur();
    await settle();
    expect(names()).toEqual(['Red Potion', 'Leaf', 'Lemona']);
  });

  it('moves to the filter button after the last Count box in the filter, and stays on the line once none is left', () => {
    setup();
    add('Red Potion\nLeaf\nBlue Bamboo Hat\nOverall Armor LUK Scroll: Greater');
    $('apNeedCount').click();
    expect(names()).toEqual(['Red Potion', 'Leaf', 'Overall Armor LUK Scroll: Greater']);
    // the last one first: two are still to do, so the filter button is next
    const last = box('Overall Armor LUK Scroll: Greater', 'qty');
    last.value = '3';
    enter(last);
    expect(document.activeElement).toBe($('apNeedCount'));
    // then the rest: the filter goes off, and focus stays on the line just counted
    box('Red Potion', 'qty').value = '7';
    enter(box('Red Potion', 'qty'));
    expect(document.activeElement).toBe(box('Leaf', 'qty'));
    box('Leaf', 'qty').value = '2';
    enter(box('Leaf', 'qty'));
    expect($('apNeedWrap').hidden).toBe(true);
    expect(document.activeElement).toBe(box('Leaf', 'qty'));
  });

  it('says out loud that Clear asks first, and that it cleared', () => {
    vi.useFakeTimers();
    setup();
    add('Red Potion x5');
    const clear = $('apClear'), msg = $('apMsg');
    expect(msg.getAttribute('role')).toBe('status');
    clear.click();
    expect(clear.textContent).toBe('Click again to clear');
    expect(msg.textContent).toBe('Click again to clear.');
    // not clicked again: it goes back, and so does the message
    vi.advanceTimersByTime(4100);
    expect(clear.textContent).toBe('Clear');
    expect(msg.textContent).toBe('');
    clear.click();
    clear.click();
    expect(names()).toEqual([]);
    expect(msg.textContent).toBe('Cleared.');
  });

  it('highlights the line hovered before when the one hovered last is taken back', () => {
    const view = setup();
    hover(view, 'Leaf', 100);
    hover(view, 'Red Potion', 400);
    expect(document.querySelector('#apBody tr.last .nm-n')!.textContent).toBe('Red Potion');
    $('apUndo').click();
    expect(names()).toEqual(['Leaf']);
    expect(document.querySelector('#apBody tr.last .nm-n')?.textContent).toBe('Leaf');
    expect(view.glance().last?.name).toBe('Leaf');
  });
});
