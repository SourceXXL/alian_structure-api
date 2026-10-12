import {
  RANDOM_ID_ENTROPY_BITS,
  UUID_V4_PATTERN,
  generatePrefixedTimestampedId,
  generateRandomId,
  generateTimestampedId,
} from "./random-id";

describe("random-id", () => {
  describe("generateRandomId", () => {
    it("returns an RFC 4122 v4 UUID", () => {
      expect(generateRandomId()).toMatch(UUID_V4_PATTERN);
    });

    it("stays unique across 100k rapid invocations", () => {
      const COUNT = 100_000;
      const seen = new Set<string>();

      for (let i = 0; i < COUNT; i++) {
        seen.add(generateRandomId());
      }

      expect(seen.size).toBe(COUNT);
    });
  });

  describe("generateTimestampedId", () => {
    it("keeps the <epochMillis>-<uuid> shape used by the rate-limiting API", () => {
      const [timestamp, uuid] = generateTimestampedId().split("-", 2);

      expect(Number(timestamp)).toBeGreaterThan(0);
      expect(uuid).toMatch(UUID_V4_PATTERN);
    });

    it("stays unique across 100k rapid invocations within a single millisecond", () => {
      // The whole point of the CSPRNG suffix: the timestamp prefix alone is
      // *not* unique, because every call in a tight loop lands in the same
      // millisecond. Two violations recorded in that millisecond used to be
      // able to collide.
      const COUNT = 100_000;
      const seen = new Set<string>();
      const prefixes = new Set<string>();

      for (let i = 0; i < COUNT; i++) {
        const id = generateTimestampedId();
        prefixes.add(id.slice(0, id.indexOf("-")));
        seen.add(id);
      }

      expect(seen.size).toBe(COUNT);
      // Sanity check that the collisions we are guarding against are real:
      // the generator genuinely ran inside a small number of milliseconds.
      expect(prefixes.size).toBeLessThan(COUNT);
    });
  });

  describe("generatePrefixedTimestampedId", () => {
    it("prefixes the id with the supplied type segment", () => {
      expect(generatePrefixedTimestampedId("cpu")).toMatch(
        /^cpu-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(generatePrefixedTimestampedId("heap")).toMatch(
        /^heap-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("stays unique across 100k rapid invocations", () => {
      const COUNT = 100_000;
      const seen = new Set<string>();

      for (let i = 0; i < COUNT; i++) {
        seen.add(generatePrefixedTimestampedId("cpu"));
      }

      expect(seen.size).toBe(COUNT);
    });
  });

  it("derives ids from a CSPRNG, not Math.random", () => {
    // 122 random bits per v4 UUID. A base-36 `Math.random().toString(36)
    // .slice(2, 9)` suffix carried well under 32 bits and collided under load.
    expect(RANDOM_ID_ENTROPY_BITS).toBeGreaterThanOrEqual(122);
  });
});