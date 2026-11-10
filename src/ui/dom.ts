/** An element the page is known to have; a missing one is a bug, so it throws. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

/** Calls `handle` with the file picked in a file input, then clears it so the same file can be picked again. */
export function onFile(id: string, handle: (f: File) => Promise<void>): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try { await handle(f); } finally { input.value = ''; }
  });
}
