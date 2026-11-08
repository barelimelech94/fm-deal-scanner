import type { Engine } from '../engine';
import type { AppraisalData, AppraisalEntry, TooltipRead } from '../lib/types';
import { statSig } from '../tooltip/statValue';
import { sigDiff } from '../vision/signature';
import { addEntry, clampQty, entryFor } from './entries';

/** What a hover did, in words for the panel. */
export interface HoverEvent {
  kind: 'added' | 'again' | 'fixed' | 'unreadable' | 'undone';
  text: string;
  /** the quantity is not known: say so, the person types it */
  warn?: boolean;
}

/** Where the hovered slot is: the tooltip's corner and the slot's width, in frame pixels. */
export interface HoverSpot { x: number; y: number; pitch: number }

/** A slot hovered before: remembered so hovering it again counts it once. */
interface Slot { key: string; sig: string; x: number; y: number; entryId: string; qty: number; unsure: boolean }
interface Undo { slot: Slot; created: boolean }

const MAX_SLOTS = 600;
/** Equips carry stats or upgrade slots on their tooltip; scrolls, potions and the like do not, and stack. */
export const hasStats = (t: TooltipRead): boolean => t.stats.length > 0 || t.remaining != null;

/**
 * Turns the tooltips read while scanning into lines of the appraisal. One slot hovered is one item (an equip) or
 * one stack (a scroll, a potion), however many times it is hovered; the same item in another slot adds to
 * its line. A tooltip is only read once it has stayed put for two checks, so moving across items doesn't count them.
 */
export class HoverCollector {
  /** hovers count only while this is on */
  scanning = false;
  last: HoverEvent | null = null;
  private slots: Slot[] = [];
  private undos: Undo[] = [];
  private waiting: Float32Array | null = null;
  private done: Float32Array | null = null;

  constructor(private readonly e: Engine, private readonly data: AppraisalData) {}

  /** No tooltip on screen: the next one is new, even if it is the same. */
  noTooltip(): void { this.waiting = null; this.done = null; }

  /**
   * Whether to read this tooltip now. A tooltip already read is not read again. A still screenshot is read
   * at once; a live screen must show the same tooltip twice running first.
   */
  due(sig: Float32Array, live: boolean): boolean {
    if (this.done && sigDiff(sig, this.done) < 2) return false;
    if (live && !(this.waiting && sigDiff(sig, this.waiting) < 2)) { this.waiting = sig; return false; }
    this.waiting = null; this.done = sig;
    return true;
  }

  private entryOf(id: string): AppraisalEntry | undefined { return this.data.entries.find((x) => x.id === id); }
  private refresh(entry: AppraisalEntry): void {
    if (this.slots.some((s) => s.entryId === entry.id && s.unsure)) entry.unsure = true; else delete entry.unsure;
  }

  /** Puts a read tooltip on the appraisal. `count` is the stack size read off the slot, when it could be. */
  ingest(tip: TooltipRead, spot: HoverSpot, count: number | null = null): HoverEvent {
    const equip = hasStats(tip), sig = statSig(tip);
    const made = entryFor(this.e, tip.name, equip ? 1 : count ?? 1, equip ? tip : undefined);
    const near = (s: Slot) => Math.abs(s.x - spot.x) < spot.pitch * 0.75 && Math.abs(s.y - spot.y) < spot.pitch * 0.75;
    const known = this.slots.find((s) => s.key === made.key && s.sig === sig && near(s));
    const there = known && this.entryOf(known.entryId);

    if (known && there) {
      // the same slot again; a count that could not be read before may be readable now
      if (!equip && count != null && (known.unsure || count !== known.qty)) {
        there.qty = clampQty(there.qty - known.qty + count);
        known.qty = count; known.unsure = false;
        this.refresh(there);
        return (this.last = { kind: 'fixed', text: `${made.name}: count is ${count}` });
      }
      return (this.last = { kind: 'again', text: `${made.name} is already counted` });
    }
    if (known) this.slots = this.slots.filter((s) => s !== known);   // its line was removed: count it afresh

    const unsure = !equip && count == null;
    const entry = addEntry(this.data.entries, made);
    const slot: Slot = { key: made.key, sig, x: spot.x, y: spot.y, entryId: entry.id, qty: made.qty, unsure };
    this.slots.push(slot);
    if (this.slots.length > MAX_SLOTS) this.slots.shift();
    this.undos.push({ slot, created: entry === made });
    this.refresh(entry);
    return (this.last = {
      kind: 'added', text: `Added ${made.name}${made.qty > 1 ? ` ×${made.qty}` : ''}${unsure ? ': type how many you have in its Qty box' : ''}`, warn: unsure,
    });
  }

  /** A person set this line's quantity: it is no longer in doubt. */
  confirm(entryId: string): void {
    for (const s of this.slots) if (s.entryId === entryId) s.unsure = false;
    const entry = this.entryOf(entryId);
    if (entry) delete entry.unsure;
  }

  /** A tooltip was there but is not an item the scanner could read. */
  unreadable(lines: readonly string[]): HoverEvent {
    return (this.last = { kind: 'unreadable', text: `Couldn't tell which item that is${lines[1] ? ` ("${lines[1].slice(0, 40)}")` : ''}. Hover it again, or add it by name.`, warn: true });
  }

  /** Takes back the last item added by a hover. */
  undo(): HoverEvent | null {
    const u = this.undos.pop();
    if (!u) return null;
    this.slots = this.slots.filter((s) => s !== u.slot);
    const entry = this.entryOf(u.slot.entryId);
    if (entry) {
      entry.qty = clampQty(entry.qty - u.slot.qty);
      if (u.created || entry.qty < 1) this.data.entries = this.data.entries.filter((x) => x !== entry);
      else this.refresh(entry);
    }
    return (this.last = { kind: 'undone', text: `Took back ${entry?.name ?? 'the last item'}` });
  }

  get canUndo(): boolean { return this.undos.length > 0; }

  /** The appraisal was cleared: forget the slots seen. */
  forget(): void { this.slots = []; this.undos = []; this.last = null; }
}
