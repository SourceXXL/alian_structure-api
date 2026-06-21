import {
  ReconnectBackoff,
  HeartbeatPolicy,
  EventBuffer,
  ConnectionPool,
  DEFAULT_BACKOFF,
} from "./connection-policy";

describe("ReconnectBackoff", () => {
  it("grows exponentially and caps at maxMs (30s)", () => {
    expect(ReconnectBackoff.ceilingFor(0)).toBe(500);
    expect(ReconnectBackoff.ceilingFor(1)).toBe(1000);
    expect(ReconnectBackoff.ceilingFor(2)).toBe(2000);
    expect(ReconnectBackoff.ceilingFor(100)).toBe(DEFAULT_BACKOFF.maxMs); // capped
  });

  it("never exceeds the cap with full jitter", () => {
    const b = new ReconnectBackoff({}, () => 1); // rng max
    for (let i = 0; i < 50; i++) {
      expect(b.next()).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
    }
  });

  it("returns the deterministic ceiling when jitter disabled", () => {
    const b = new ReconnectBackoff({ jitter: false });
    expect(b.next()).toBe(500);
    expect(b.next()).toBe(1000);
  });

  it("resets the schedule on success", () => {
    const b = new ReconnectBackoff({ jitter: false });
    b.next();
    b.next();
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.next()).toBe(500);
  });

  it("honors maxRetries", () => {
    const b = new ReconnectBackoff({ maxRetries: 2 });
    expect(b.shouldRetry()).toBe(true);
    b.next();
    b.next();
    expect(b.shouldRetry()).toBe(false);
  });
});

describe("HeartbeatPolicy", () => {
  const hp = new HeartbeatPolicy();
  it("flags a ping due after the interval (30s)", () => {
    expect(hp.isPingDue(0, 29_000)).toBe(false);
    expect(hp.isPingDue(0, 30_000)).toBe(true);
  });
  it("flags staleness after 5 minutes", () => {
    expect(hp.isStale(0, 299_000)).toBe(false);
    expect(hp.isStale(0, 300_000)).toBe(true);
  });
});

describe("EventBuffer", () => {
  it("replays only events missed since a sequence number", () => {
    const buf = new EventBuffer<string>(10);
    const s1 = buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.since(s1)).toEqual(["b", "c"]);
    expect(buf.since(0)).toEqual(["a", "b", "c"]);
  });
  it("drops oldest beyond capacity (bounded)", () => {
    const buf = new EventBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => buf.push(n));
    expect(buf.size).toBe(3);
    expect(buf.since(0)).toEqual([3, 4, 5]);
    expect(buf.lastSeq).toBe(5);
  });
  it("rejects a non-positive capacity", () => {
    expect(() => new EventBuffer(0)).toThrow();
  });
});

describe("ConnectionPool", () => {
  it("admits up to the max concurrent then rejects", () => {
    const pool = new ConnectionPool(2);
    expect(pool.admit("a", 0)).toBe(true);
    expect(pool.admit("b", 0)).toBe(true);
    expect(pool.admit("c", 0)).toBe(false); // full
    expect(pool.size).toBe(2);
  });
  it("re-admitting an existing id touches, not rejects, even when full", () => {
    const pool = new ConnectionPool(1);
    pool.admit("a", 0);
    expect(pool.admit("a", 100)).toBe(true);
    expect(pool.size).toBe(1);
  });
  it("frees capacity after removal", () => {
    const pool = new ConnectionPool(1);
    pool.admit("a", 0);
    expect(pool.hasCapacity()).toBe(false);
    pool.remove("a");
    expect(pool.hasCapacity()).toBe(true);
  });
  it("evicts stale connections and frees resources", () => {
    const pool = new ConnectionPool(10);
    pool.admit("fresh", 0);
    pool.admit("stale", 0);
    pool.touch("fresh", 300_000); // keep fresh alive
    const evicted = pool.evictStale(300_000);
    expect(evicted).toEqual(["stale"]);
    expect(pool.size).toBe(1);
  });
});
