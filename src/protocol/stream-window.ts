export class StreamBackpressureWindow {
  private nextSeq = 0;
  private readonly unacked = new Set<number>();
  private readonly waiters = new Set<() => void>();

  constructor(readonly size: number) {
    if (!Number.isSafeInteger(size) || size < 1) throw new Error("Stream window size must be a positive integer.");
  }

  get outstanding(): number {
    return this.unacked.size;
  }

  get canSend(): boolean {
    return this.unacked.size < this.size;
  }

  reserve(): number {
    if (!this.canSend) throw new Error("STREAM_BACKPRESSURE");
    const seq = this.nextSeq++;
    this.unacked.add(seq);
    return seq;
  }

  acknowledge(seq: number): void {
    if (!this.unacked.delete(seq)) throw new Error(`Unknown stream acknowledgement: ${seq}`);
    if (this.canSend) {
      for (const resolve of this.waiters) resolve();
      this.waiters.clear();
    }
  }

  async waitForSlot(signal?: AbortSignal): Promise<void> {
    if (this.canSend) return;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled.");
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener("abort", onAbort);
        this.waiters.delete(done);
        resolve();
      };
      const onAbort = () => {
        this.waiters.delete(done);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation cancelled."));
      };
      this.waiters.add(done);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  reset(): void {
    this.unacked.clear();
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
    this.nextSeq = 0;
  }
}
