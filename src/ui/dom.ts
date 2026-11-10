/** An element the page is known to have; a missing one is a bug, so it throws. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
}

/** Calls `handle` with the files picked in a file input, then clears it so the same files can be picked again. */
export function onFiles(id: string, handle: (files: File[]) => Promise<void>): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    try { await handle(files); } finally { input.value = ''; }
  });
}

/** Calls `handle` with the file picked in a file input, then clears it so the same file can be picked again. */
export function onFile(id: string, handle: (f: File) => Promise<void>): void {
  onFiles(id, (files) => handle(files[0]!));
}
