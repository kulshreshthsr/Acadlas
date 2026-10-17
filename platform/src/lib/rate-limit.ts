// A small fixed-window counter, kept in memory.
//
// Good for one API process, which is how Acadlas runs today. If the API is ever scaled to
// several processes, this has to move to shared storage (Postgres or Redis) or each process
// would allow the full limit on its own.
type Bucket = { count: number; resetAt: number };

/** Most entries a limiter holds before it starts dropping the oldest, so rotating keys cannot exhaust memory. */
const MAX_KEYS = 50_000;

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private now: () => number = Date.now) {
    const sweep = setInterval(() => this.sweep(), 60_000);
    sweep.unref?.();
  }

  /** Counts one hit against `key`. Refuses once `max` hits have landed inside `windowMs`. */
  hit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
    const bucket = this.current(key, windowMs);
    if (bucket.count >= max) return { ok: false, retryAfter: this.retryAfter(bucket) };
    bucket.count += 1;
    return { ok: true, retryAfter: 0 };
  }

  /** Whether `key` has already reached `max`, without counting this check as a hit. */
  blocked(key: string, max: number): { blocked: boolean; retryAfter: number } {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= this.now() || bucket.count < max) return { blocked: false, retryAfter: 0 };
    return { blocked: true, retryAfter: this.retryAfter(bucket) };
  }

  /** Counts a hit without checking the limit — for recording a failure after the fact. */
  record(key: string, windowMs: number): void {
    this.current(key, windowMs).count += 1;
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }

  private current(key: string, windowMs: number): Bucket {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= MAX_KEYS) this.makeRoom();
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private retryAfter(bucket: Bucket): number {
    return Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000));
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }

  private makeRoom(): void {
    this.sweep();
    // Still full: drop the oldest tenth. Map keeps insertion order, so these are the stalest windows.
    let drop = this.buckets.size - MAX_KEYS + Math.ceil(MAX_KEYS / 10);
    for (const key of this.buckets.keys()) {
      if (drop-- <= 0) break;
      this.buckets.delete(key);
    }
  }
}
