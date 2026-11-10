import type { ScanMode } from '../lib/types';
import type { ScanStatus } from '../scan/controller';
import { $ } from './dom';

/** What the capture control shows. */
export interface CaptureState {
  status(): ScanStatus;
  readonly error: string | null;
  readonly capturing: boolean;
  readonly mode: ScanMode;
}

export interface CaptureActions { start(): void; stop(): void; overlay(): void; dismissError(): void }

/**
 * The bar's capture control, shared by both modes: the mode, Start capture when idle, and when running one line
 * saying what it is doing and a Stop button. Errors show in a bar under it.
 */
export class CaptureBar {
  constructor(private readonly s: CaptureState, private readonly act: CaptureActions) {}

  wire(): void {
    $('btnStart').addEventListener('click', () => this.act.start());
    $('btnStop').addEventListener('click', () => this.act.stop());
    $('btnPip').addEventListener('click', () => this.act.overlay());
    $('captureErrorClose').addEventListener('click', () => this.act.dismissError());
  }

  render(): void {
    const st = this.s.status(), on = this.s.capturing;
    const pill = $('status'), text = $('statusText');
    pill.dataset.state = st.state;
    text.innerHTML = st.html;
    pill.title = text.textContent ?? '';
    $('captureMode').textContent = this.s.mode === 'inventory' ? 'Inventory' : 'Deals';
    $('btnStart').hidden = on;
    $('btnStop').hidden = !on;
    $<HTMLButtonElement>('btnPip').disabled = !on;
    const err = this.s.error;
    $('captureError').hidden = !err;
    if (err) $('captureErrorText').innerHTML = err;
  }
}
