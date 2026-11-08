// HTML for the appraisal panel, built from an appraisal's result. Pure, like views.ts: everything comes in as
// arguments, so it is tested without a browser.
import { APPRAISAL_MODES, type AppraisalLine, type AppraisalResult, type LineSource, type LineTag } from '../appraisal/appraise';
import { esc, fmt, fmtEach } from '../lib/format';
import { marketTip, type MarketIndex } from '../market/marketIndex';
import { iconHtml } from './views';

export const TAG_TEXT: Record<LineTag, string> = { priced: 'Priced', rough: 'Rough', unpriced: 'No price', ignored: 'Skipped' };
const SRC_TEXT: Record<LineSource, string> = { yours: 'your price', market: 'market', seen: 'your sightings', line: 'typed here', npc: 'NPC price' };

const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** What a line's tag means, for its tooltip. */
function tagTip(l: AppraisalLine, market: MarketIndex): string {
  if (l.tag === 'unpriced') return 'No price on the tracker or in your sightings. Type one in the Each box.';
  if (l.tag === 'ignored') return 'Left out of the total.';
  const tip = marketTip(market.get(l.entry.key));
  if (l.src === 'npc') return "No market price, so this is what an NPC pays for it: the least it is worth. Type a price to use your own.";
  return l.tag === 'rough' ? `A rough guide: fewer than 5 sales, or copies sell for very different prices. ${tip}` : tip;
}

/** One line: the item, how many, the price each (typeable), the total, and whether it counts. */
export function appraisalRowHtml(l: AppraisalLine, market: MarketIndex, failed?: ReadonlySet<string>): string {
  const e = l.entry;
  const note = [l.set ? 'priced per set' : '', l.stats?.summary ?? '', l.npc != null ? `NPC pays ${fmtEach(l.npc)}` : '', l.known ? '' : 'not on the tracker'].filter(Boolean).join(' · ');
  const skip = e.ignored;
  return `<tr class="ap-${l.tag}" data-id="${esc(e.id)}">
    <td class="name"><span class="nm">${iconHtml(market, e.key, failed)}<span class="nm-t"><span class="nm-n">${esc(l.name)}</span>${note ? `<span class="sub">${esc(note)}</span>` : ''}</span></span></td>
    <td class="n"><input class="cellinput${e.unsure ? ' unsure' : ''}" data-id="${esc(e.id)}" data-field="qty" value="${fmt(e.qty)}" inputmode="numeric" aria-label="${l.set ? 'Sets' : 'How many'} of ${esc(l.name)}">${e.unsure ? '<span class="sub warn" title="The scanner doesn\'t read the number on a slot. Type how many you have.">type count</span>' : ''}</td>
    <td class="n"><input class="cellinput" data-id="${esc(e.id)}" data-field="price" value="${e.price ? fmt(e.price) : ''}" placeholder="${l.unit == null ? 'price?' : fmtEach(l.unit)}" aria-label="Price each for ${esc(l.name)}">${l.src ? `<span class="sub">${SRC_TEXT[l.src]}</span>` : ''}</td>
    <td class="n"${l.tag === 'ignored' ? '' : ` title="${esc(tagTip(l, market))}"`}>${l.total == null ? '–' : fmt(l.total)}</td>
    <td><span class="chip ${l.tag}" title="${esc(tagTip(l, market))}">${TAG_TEXT[l.tag]}</span></td>
    <td class="acts"><button class="x" data-id="${esc(e.id)}" data-act="skip" aria-pressed="${skip ? 'true' : 'false'}" aria-label="${skip ? 'Count' : 'Skip'} ${esc(l.name)}" title="${skip ? 'Count it again' : 'Leave it out of the total'}">${skip ? '↺' : '⊘'}</button><button class="x" data-id="${esc(e.id)}" data-act="del" aria-label="Remove ${esc(l.name)}" title="Remove">×</button></td>
  </tr>`;
}

export function appraisalRowsHtml(r: AppraisalResult, market: MarketIndex, failed?: ReadonlySet<string>): string {
  return r.lines.map((l) => appraisalRowHtml(l, market, failed)).join('');
}

export interface AppraisalText { meta: string; total: string; rough: string; warn: string; offerLabel: string; offer: string; mode: string }

/** The words around the table: how many, the total, what to be careful about, the offer. */
export function appraisalText(r: AppraisalResult): AppraisalText {
  const skipped = r.ignored ? `, ${fmt(r.ignored)} skipped` : '';
  return {
    meta: r.kinds || r.ignored ? `${plural(r.kinds, 'kind', 'kinds')}, ${plural(r.items, 'item', 'items')}${skipped}` : 'Nothing added yet',
    total: fmt(r.total),
    rough: r.rough ? `${fmt(r.rough)} of it is a rough price` : '',
    warn: r.unpriced ? `${plural(r.unpriced, 'item has', 'items have')} no price and ${r.unpriced === 1 ? 'is' : 'are'} not counted. Type a price in its Each box.` : '',
    offerLabel: `Offer at ${r.bulk}%`,
    offer: fmt(r.quote),
    mode: `${APPRAISAL_MODES[r.mode].label}: ${APPRAISAL_MODES[r.mode].blurb}.`,
  };
}

/** The pop-out overlay's block: the running total, and the button that starts and pauses scanning. */
export function overlayAppraisalHtml(r: AppraisalResult, scanning: boolean, hint: string): string {
  if (!scanning && !r.kinds) return '';
  const t = appraisalText(r);
  return `<div class="apbar${scanning ? ' on' : ''}"><div><b>Appraisal</b> <span class="dim">${esc(t.meta)}</span>`
    + `<div class="aptot">${esc(t.total)}${r.bulk === 100 ? '' : ` <small>offer ${esc(t.offer)}</small>`}</div></div>`
    + `<button class="btn small${scanning ? '' : ' primary'}" data-act="scan">${scanning ? 'Pause' : 'Scan hovers'}</button></div>`
    + (hint ? `<p class="apnote">${esc(hint)}</p>` : '')
    + (r.unpriced ? `<p class="apnote warn">${esc(plural(r.unpriced, 'item', 'items'))} not priced</p>` : '');
}
