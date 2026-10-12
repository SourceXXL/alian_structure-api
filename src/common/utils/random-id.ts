import { randomUUID } from "crypto";

/**
 * Cryptographically secure random identifiers.
 *
 * These replace ad-hoc `Math.random()` identifiers that were previously used
 * for rate-limit violation records, sliding-window bucket members and
 * profiling/tracing correlation ids.
 *
 * `Math.random()` is a non-cryptographic PRNG: it is not seeded from a CSPRNG,
 * its output is predictable, and collisions are realistic for the short
 * base-36 suffixes that were being generated. That matters because the values
 * produced here are:
 *
 *  - written as *members* of the rate-limiter sliding-window sorted set, where a
 *    collision means one request evicts or double-counts another client's window
 *    entry (a rate-limit bypass under load), and
 *  - returned to clients as rate-limit violation `id` values and persisted into
 *    the audit trail, where a collision makes two distinct violations
 *    indistinguishable.
 *
 * `crypto.randomUUID()` (RFC 4122 v4) draws 122 bits from the platform CSPRNG,
 * so collisions are not a practical concern.
 */

/** Number of random bits in a v4 UUID, before the version/variant bits. */
export const RANDOM_ID_ENTROPY_BITS = 122;

/**
 * Canonical RFC 4122 v4 UUID string (36 chars, hyphenated).
 *
 * Use for correlation/tracing ids where the value is opaque and only needs to
 * be globally unique.
 */
export function generateRandomId(): string {
  return randomUUID();
}

/**
 * `<epochMillis>-<uuid>` request/record identifier.
 *
 * The leading epoch-millisecond prefix is retained deliberately: several of
 * these ids are externally visible on the rate-limiting API and are used to
 * build on-disk profile filenames, where the timestamp keeps the entries
 * lexicographically sortable. The suffix is now a CSPRNG UUID instead of a
 * `Math.random()` base-36 fragment, which is what actually guarantees
 * uniqueness.
 */
export function generateTimestampedId(): string {
  return `${Date.now()}-${randomUUID()}`;
}

/**
 * `<type>-<epochMillis>-<uuid>` identifier.
 *
 * Used for profiling artefacts (CPU profiles, heap snapshots) where the `type`
 * segment makes the on-disk filename self-describing.
 */
export function generatePrefixedTimestampedId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID()}`;
}

/**
 * RFC 4122 v4 UUID shape, used to assert in tests that generated ids keep the
 * collision-resistant shape after the `Math.random()` removal.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;