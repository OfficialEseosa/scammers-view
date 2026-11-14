/** Tiny semaphore so a scan's many parallel Claude calls don't trip rate limits. */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
