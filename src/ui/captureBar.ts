import type { ScanStatus } from '../scan/controller';
import { $ } from './dom';
import { setHidden, setHtml } from './render';

/** What the capture control shows. */
export interface CaptureState {
  status(): ScanStatus;
  readonly error: string | null;
  readonly capturing: boolean;
}

export interface CaptureActions { start(): void; stop(): void; overlay(): void; dismissError(): void }

/**
 * The bar's capture control, shared by both modes: Start capture when idle, and when running one line saying what
 * it is doing (which says the mode) and a Stop button. Errors show in a bar under it.
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
    if (setHtml(text, st.html)) pill.title = text.textContent ?? '';
    setHidden($('btnStart'), on);
    setHidden($('btnStop'), !on);
    $<HTMLButtonElement>('btnPip').disabled = !on;
    const err = this.s.error;
    setHidden($('captureError'), !err);
    if (err) setHtml($('captureErrorText'), err);
  }
}
