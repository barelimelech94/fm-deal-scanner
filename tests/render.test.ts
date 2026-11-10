// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveLater } from '../src/store/saveLater';
import { DrawGate, setHidden, setHtml, setText } from '../src/ui/render';

/** Counts the changes made under `el`. */
async function mutations(el: Element, act: () => void): Promise<number> {
  let n = 0;
  const obs = new MutationObserver((list) => { n += list.length; });
  obs.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
  act();
  await new Promise((r) => setTimeout(r, 0));
  obs.disconnect();
  return n;
}

describe('setHtml', () => {
  it('writes only when the HTML differs from what it wrote last', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    // what the browser reads back is not what was written (attribute order, entities): it compares what it wrote
    const html = '<span title="a &amp; b" class="x">1 &lt; 2</span>';
    expect(setHtml(el, html)).toBe(true);
    expect(el.querySelector('span')!.textContent).toBe('1 < 2');
    expect(await mutations(el, () => { for (let i = 0; i < 10; i++) setHtml(el, html); })).toBe(0);
    expect(setHtml(el, '<b>new</b>')).toBe(true);
    expect(el.innerHTML).toBe('<b>new</b>');
  });

  it('keeps apart what it wrote in each element', () => {
    const a = document.createElement('div'), b = document.createElement('div');
    expect(setHtml(a, 'x')).toBe(true);
    expect(setHtml(b, 'x')).toBe(true);
    expect(setHtml(a, 'x')).toBe(false);
  });
});

describe('setText and setHidden', () => {
  it('touch the element only on a change', async () => {
    const el = document.createElement('p');
    document.body.append(el);
    setText(el, 'hi');
    setHidden(el, true);
    expect(await mutations(el, () => { setText(el, 'hi'); setHidden(el, true); })).toBe(0);
    expect(setText(el, 'ho')).toBe(true);
    setHidden(el, false);
    expect(el.hidden).toBe(false);
  });
});

describe('DrawGate', () => {
  it('is due for a new version, not for the same, and always when forced', () => {
    const g = new DrawGate();
    expect(g.due('1')).toBe(true);
    expect(g.due('1')).toBe(false);
    expect(g.due('2')).toBe(true);
    expect(g.due('2', true)).toBe(true);
    g.reset();
    expect(g.due('2')).toBe(true);
  });
});

describe('SaveLater', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('saves a second after the last change, once', () => {
    vi.useFakeTimers();
    const save = vi.fn(), s = new SaveLater(save, 1000);
    s.request();
    vi.advanceTimersByTime(600);
    s.request();
    vi.advanceTimersByTime(600);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves at once what is waiting when flushed, and nothing when nothing waits', () => {
    vi.useFakeTimers();
    const save = vi.fn(), s = new SaveLater(save, 1000);
    s.flush();
    expect(save).not.toHaveBeenCalled();
    s.request();
    expect(s.waiting).toBe(true);
    s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.waiting).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
