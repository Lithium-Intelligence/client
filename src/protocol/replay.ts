export class RequestReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 10_000,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive.");
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be positive.");
  }

  accept(id: string, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    if (this.seen.has(id)) return false;
    this.seen.set(id, nowMs);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (!oldest) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  forget(id: string): void {
    this.seen.delete(id);
  }

  clear(): void {
    this.seen.clear();
  }

  private prune(nowMs: number): void {
    const threshold = nowMs - this.ttlMs;
    for (const [id, at] of this.seen) {
      if (at > threshold) break;
      this.seen.delete(id);
    }
  }
}
