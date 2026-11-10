// The "Get started" card a view shows to someone new: a few numbered steps, each ticked off as it is done,
// and gone once all are. The view says what its steps are and when each is done; this knows nothing of views.
import { esc } from '../lib/format';
import { setHidden, setHtml } from './render';

/** One step: what to do, whether it is done, and a button that does it (shown until it is done). */
export interface SetupStep {
  label: string;
  done: boolean;
  action?: { label: string; run(): void };
}

/** Whether every step is done: the card is then not shown. */
export const allStepsDone = (steps: readonly SetupStep[]): boolean => steps.every((s) => s.done);

/** The steps, numbered, as a list. A step's button carries its place in the list (`data-step`). */
export function setupStepsHtml(steps: readonly SetupStep[]): string {
  const items = steps.map((s, i) => {
    const button = s.action && !s.done ? ` <button class="btn small" data-step="${i}">${esc(s.action.label)}</button>` : '';
    return `<li class="step${s.done ? ' done' : ''}"><span class="mark" aria-hidden="true">${s.done ? '✓' : ''}</span>`
      + `<span class="n" aria-hidden="true">${i + 1}</span><span class="what">${esc(s.label)}${s.done ? '<span class="sr"> (done)</span>' : ''}</span>${button}</li>`;
  });
  // the list keeps its role, which some screen readers drop from a list styled without markers
  return `<ol class="steps" role="list">${items.join('')}</ol>`;
}

/**
 * A Get started card in the page: `el` holds the steps. `render` draws them, or hides the card once all are
 * done; a click on a step's button runs that step's action, as last drawn.
 */
export class SetupSteps {
  private steps: readonly SetupStep[] = [];

  constructor(private readonly card: HTMLElement, private readonly el: HTMLElement = card) {
    el.addEventListener('click', (ev) => {
      const i = (ev.target as HTMLElement).closest<HTMLElement>('[data-step]')?.dataset.step;
      if (i != null) this.steps[Number(i)]?.action?.run();
    });
  }

  render(steps: readonly SetupStep[]): void {
    this.steps = steps;
    const done = allStepsDone(steps);
    setHidden(this.card, done);
    if (!done) setHtml(this.el, setupStepsHtml(steps));
  }
}
