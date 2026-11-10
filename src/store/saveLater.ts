/** Saves once things settle: `ms` after the last request. `flush` saves at once what is waiting, before the page goes. */
export class SaveLater {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly save: () => void, private readonly ms = 1000) {}

  request(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.ms);
  }

  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }
}
