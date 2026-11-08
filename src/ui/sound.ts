/** A two-note chime for a new deal. The audio context needs a click first, so `unlock` on any. */
export class Chime {
  private ctx: AudioContext | null = null;

  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* no audio */ }
  }

  /** A short soft tick: something was added to the appraisal. */
  tick(): void {
    const a = this.ctx;
    if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = 1040;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.1);
  }

  play(): void {
    const a = this.ctx;
    if (!a) return;
    const t = a.currentTime;
    for (const [f, dt] of [[880, 0], [1320, 0.13]] as const) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
      o.connect(g).connect(a.destination);
      o.start(t + dt); o.stop(t + dt + 0.18);
    }
  }
}
