import type { Engine } from '../engine';
import type { AppraisalData, AppraisalEntry, TooltipRead } from '../lib/types';
import { statSig } from '../tooltip/statValue';
import { sigDiff } from '../vision/signature';
import { addEntry, clampQty, entryFor, isEquipItem } from './entries';

/** What a hover did, in words for the panel. */
export interface HoverEvent {
  kind: 'added' | 'again' | 'fixed' | 'unreadable' | 'undone';
  text: string;
  /** the quantity is not known: say so, the person types it */
  warn?: boolean;
  /** the appraisal line the hover added to, counted again or fixed (`added`, `again` and `fixed` only) */
  entryId?: string;
}

/** Where the hovered slot is: the tooltip's corner and the slot's width, in frame pixels. */
export interface HoverSpot { x: number; y: number; pitch: number }

/** A slot hovered before: remembered so hovering it again counts it once. */
interface Slot { key: string; sig: string; x: number; y: number; entryId: string; qty: number; unsure: boolean }
/** A hover to take back: its slot, whether it made the line, and whether its count read made the line's count known. */
interface Undo { slot: Slot; created: boolean; counted: boolean }

const MAX_SLOTS = 600;

/**
 * Turns the tooltips read while scanning into lines of the appraisal. One slot hovered is one item (an equip) or
 * one stack (a scroll, a potion), however many times it is hovered; the same item in another slot adds to
 * its line. A tooltip is only read once it has stayed put for two checks, so moving across items doesn't count them.
 */
export class HoverCollector {
  /** rises on any change: scanning turned on or off, a hover read, an undo, a count confirmed, the slots forgotten */
  version = 0;
  last: HoverEvent | null = null;
  private on = false;
  private slots: Slot[] = [];
  private undos: Undo[] = [];
  /** the lines hovered, by id, each once, the latest last */
  private hovered: string[] = [];
  private waiting: Float32Array | null = null;
  private done: Float32Array | null = null;

  constructor(private readonly e: Engine, private readonly data: AppraisalData) {}

  /** The line hovered last that is still there: once it is taken back or removed, the one hovered before it. */
  get lastId(): string | null {
    for (let i = this.hovered.length - 1; i >= 0; i--) if (this.entryOf(this.hovered[i]!)) return this.hovered[i]!;
    return null;
  }

  /** hovers count only while this is on */
  get scanning(): boolean { return this.on; }
  set scanning(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.version++;
  }

  private event(ev: HoverEvent): HoverEvent {
    this.version++;
    const id = ev.entryId;
    if (id) {
      this.hovered = this.hovered.filter((x) => x !== id);
      if (this.hovered.push(id) > MAX_SLOTS) this.hovered.shift();
    }
    return (this.last = ev);
  }

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
    const made = entryFor(this.e, tip.name), equip = isEquipItem(this.e, made.key, tip), sig = statSig(tip);
    if (equip) made.tip = tip; else made.qty = clampQty(count ?? 1);
    /** a stack whose number was read off its slot: its count is known, a 1 too */
    const read = !equip && count != null;
    const near = (s: Slot) => Math.abs(s.x - spot.x) < spot.pitch * 0.75 && Math.abs(s.y - spot.y) < spot.pitch * 0.75;
    const known = this.slots.find((s) => s.key === made.key && s.sig === sig && near(s));
    const there = known && this.entryOf(known.entryId);

    if (known && there) {
      // the same slot again; a count that could not be read before may be readable now
      if (read && (known.unsure || count !== known.qty)) {
        there.qty = clampQty(there.qty - known.qty + count);
        there.counted = true;
        known.qty = count; known.unsure = false;
        this.refresh(there);
        return this.event({ kind: 'fixed', text: `${made.name}: count is ${count}`, entryId: there.id });
      }
      return this.event({ kind: 'again', text: `${made.name} is already counted`, entryId: there.id });
    }
    if (known) this.slots = this.slots.filter((s) => s !== known);   // its line was removed: count it afresh

    const unsure = !equip && count == null;
    const entry = addEntry(this.data.entries, made);
    const counted = read && !entry.counted;
    if (counted) entry.counted = true;
    const slot: Slot = { key: made.key, sig, x: spot.x, y: spot.y, entryId: entry.id, qty: made.qty, unsure };
    this.slots.push(slot);
    if (this.slots.length > MAX_SLOTS) this.slots.shift();
    this.undos.push({ slot, created: entry === made, counted });
    this.refresh(entry);
    return this.event({
      kind: 'added', text: `Added ${made.name}${made.qty > 1 ? ` ×${made.qty}` : ''}${unsure ? ': type how many you have in its Count box' : ''}`, warn: unsure, entryId: entry.id,
    });
  }

  /** A person set this line's quantity: it is no longer in doubt. */
  confirm(entryId: string): void {
    this.version++;
    for (const s of this.slots) if (s.entryId === entryId) s.unsure = false;
    const entry = this.entryOf(entryId);
    if (entry) delete entry.unsure;
  }

  /** A tooltip was there but is not an item the scanner could read. */
  unreadable(lines: readonly string[]): HoverEvent {
    return this.event({ kind: 'unreadable', text: `Couldn't tell which item that is${lines[1] ? ` ("${lines[1].slice(0, 40)}")` : ''}. Hover it again, or add it by name.`, warn: true });
  }

  /** Takes back the last item added by a hover. */
  undo(): HoverEvent | null {
    const u = this.undos.pop();
    if (!u) return null;
    this.slots = this.slots.filter((s) => s !== u.slot);
    const entry = this.entryOf(u.slot.entryId);
    if (entry) {
      entry.qty = clampQty(entry.qty - u.slot.qty);
      if (u.counted) delete entry.counted;
      if (u.created || entry.qty < 1) this.data.entries = this.data.entries.filter((x) => x !== entry);
      else this.refresh(entry);
    }
    return this.event({ kind: 'undone', text: `Took back ${entry?.name ?? 'the last item'}` });
  }

  get canUndo(): boolean { return this.undos.length > 0; }

  /** The appraisal was cleared: forget the slots seen. */
  forget(): void { this.slots = []; this.undos = []; this.hovered = []; this.last = null; this.version++; }
}
