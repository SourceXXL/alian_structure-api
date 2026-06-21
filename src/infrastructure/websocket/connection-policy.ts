/**
 * WebSocket connection policy — pure, dependency-free primitives for robust connection management
 * (issue #55). No sockets here: just the decision logic, so it is unit-testable and reusable by both
 * the client reconnection layer and the server-side pool/heartbeat manager.
 *
 * Provides:
 *   - ReconnectBackoff   : exponential backoff with full jitter, capped (default 30s max)
 *   - HeartbeatPolicy    : "is a ping due?" / "is this connection stale?" timers
 *   - EventBuffer        : bounded ring buffer to replay events missed during a disconnect
 *   - ConnectionPool     : capacity gate (max N concurrent per upstream) + stale eviction
 */

// ── Reconnection backoff (client) ─────────────────────────────────────────────
export interface BackoffConfig {
  baseMs: number; // first delay, default 500
  maxMs: number; // cap, default 30_000 (the "max 30s delay" criterion)
  factor: number; // growth factor, default 2
  jitter: boolean; // full jitter, default true
  maxRetries?: number; // optional give-up threshold (undefined = retry forever)
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: true,
};

export class ReconnectBackoff {
  private attempt = 0;
  private readonly cfg: BackoffConfig;

  constructor(cfg: Partial<BackoffConfig> = {}, private rng: () => number = Math.random) {
    this.cfg = { ...DEFAULT_BACKOFF, ...cfg };
  }

  /** Deterministic exponential ceiling for a given attempt (no jitter), capped at maxMs. */
  static ceilingFor(attempt: number, cfg: BackoffConfig = DEFAULT_BACKOFF): number {
    const raw = cfg.baseMs * Math.pow(cfg.factor, Math.max(0, attempt));
    return Math.min(cfg.maxMs, raw);
  }

  /** Should we keep trying? False once maxRetries is exhausted. */
  shouldRetry(): boolean {
    return this.cfg.maxRetries === undefined || this.attempt < this.cfg.maxRetries;
  }

  /** Next delay (ms) and advance the attempt counter. Full jitter in [0, ceiling]. */
  next(): number {
    const ceiling = ReconnectBackoff.ceilingFor(this.attempt, this.cfg);
    this.attempt += 1;
    if (!this.cfg.jitter) return ceiling;
    // full jitter in [0, ceiling], clamped to the cap (defensive against rng edge values)
    return Math.min(this.cfg.maxMs, Math.floor(this.rng() * (ceiling + 1)));
  }

  /** Call after a successful connection to reset the schedule. */
  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}

// ── Heartbeat / staleness (server + client) ───────────────────────────────────
export interface HeartbeatConfig {
  intervalMs: number; // ping cadence, default 30_000
  staleMs: number; // inactive threshold, default 300_000 (5 min)
}

export const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  intervalMs: 30_000,
  staleMs: 300_000,
};

export class HeartbeatPolicy {
  private readonly cfg: HeartbeatConfig;
  constructor(cfg: Partial<HeartbeatConfig> = {}) {
    this.cfg = { ...DEFAULT_HEARTBEAT, ...cfg };
  }

  /** Is a heartbeat ping due, given the last ping time? */
  isPingDue(lastPingMs: number, nowMs: number): boolean {
    return nowMs - lastPingMs >= this.cfg.intervalMs;
  }

  /** Is the connection stale (no activity within staleMs)? */
  isStale(lastActivityMs: number, nowMs: number): boolean {
    return nowMs - lastActivityMs >= this.cfg.staleMs;
  }
}

// ── Bounded replay buffer ─────────────────────────────────────────────────────
/** Ring buffer of recent events so a reconnecting client can replay what it missed. */
export class EventBuffer<T> {
  private items: { seq: number; event: T }[] = [];
  private seqCounter = 0;
  constructor(private readonly capacity = 1000) {
    if (capacity <= 0) throw new Error("capacity must be > 0");
  }

  /** Append an event; returns its monotonically increasing sequence number. */
  push(event: T): number {
    const seq = ++this.seqCounter;
    this.items.push({ seq, event });
    if (this.items.length > this.capacity) this.items.shift();
    return seq;
  }

  /** Events with seq strictly greater than `afterSeq` (what the client missed). */
  since(afterSeq: number): T[] {
    return this.items.filter((i) => i.seq > afterSeq).map((i) => i.event);
  }

  get lastSeq(): number {
    return this.seqCounter;
  }

  get size(): number {
    return this.items.length;
  }
}

// ── Connection pool capacity + stale eviction (server) ────────────────────────
export interface PooledConnection {
  id: string;
  lastActivityMs: number;
}

export class ConnectionPool {
  private readonly conns = new Map<string, PooledConnection>();
  constructor(
    private readonly maxPerUpstream = 100,
    private readonly heartbeat = new HeartbeatPolicy(),
  ) {}

  get size(): number {
    return this.conns.size;
  }

  /** True if there is room for another connection. */
  hasCapacity(): boolean {
    return this.conns.size < this.maxPerUpstream;
  }

  /** Admit a connection if under capacity. Returns false (rejected) when full. */
  admit(id: string, nowMs: number): boolean {
    if (this.conns.has(id)) {
      this.touch(id, nowMs);
      return true;
    }
    if (!this.hasCapacity()) return false;
    this.conns.set(id, { id, lastActivityMs: nowMs });
    return true;
  }

  touch(id: string, nowMs: number): void {
    const c = this.conns.get(id);
    if (c) c.lastActivityMs = nowMs;
  }

  remove(id: string): void {
    this.conns.delete(id);
  }

  /** Close + free stale connections; returns the ids evicted. */
  evictStale(nowMs: number): string[] {
    const evicted: string[] = [];
    for (const [id, c] of this.conns) {
      if (this.heartbeat.isStale(c.lastActivityMs, nowMs)) {
        this.conns.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }
}
