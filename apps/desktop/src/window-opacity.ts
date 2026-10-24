type PendingOpacity = { value: number; waiters: { resolve: () => void; reject: (reason: unknown) => void }[] };

/** Keep native previews in order, collapsing rapid slider moves to the latest value. */
export class WindowOpacityController {
  private pending: PendingOpacity | undefined;
  private running = false;
  private readonly apply: (opacity: number) => Promise<void>;

  constructor(apply: (opacity: number) => Promise<void>) { this.apply = apply; }

  set(value: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.pending) this.pending.value = value;
      else this.pending = { value, waiters: [] };
      this.pending.waiters.push({ resolve, reject });
      void this.flush();
    });
  }

  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = undefined;
        try {
          await this.apply(next.value);
          next.waiters.forEach(waiter => waiter.resolve());
        } catch (error) {
          next.waiters.forEach(waiter => waiter.reject(error));
        }
      }
    } finally { this.running = false; }
  }
}
