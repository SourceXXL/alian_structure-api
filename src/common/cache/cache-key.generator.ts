import { createHash } from "crypto";

/**
 * Generates deterministic, versioned cache keys.
 *
 * Keys follow the pattern:
 *   `{prefix}:{version}:{namespace}:{hash(args)}`
 *
 * The hash is a truncated SHA-256 of the JSON-serialised arguments, keeping
 * keys a fixed maximum length regardless of argument complexity.
 */
export class CacheKeyGenerator {
  private readonly prefix: string;
  private readonly version: string;
  private readonly hashLength: number;

  constructor(
    prefix = "alian:cache:",
    version = "v1",
    hashLength = 16,
  ) {
    this.prefix = prefix;
    this.version = version;
    this.hashLength = hashLength;
  }

  /**
   * Build a cache key from a namespace and argument values.
   *
   * @example
   *   const gen = new CacheKeyGenerator('alian:cache:', 'v1');
   *   gen.generate('user', 42);
   *   // => "alian:cache:v1:user:a1b2c3d4e5f6g7h8"
   */
  generate(namespace: string, ...args: unknown[]): string {
    const argsHash = this.hashArgs(args);
    return `${this.prefix}${this.version}:${namespace}:${argsHash}`;
  }

  /**
   * Build a prefix pattern for bulk invalidation of all keys under a namespace.
   *
   * @example
   *   gen.namespacePrefix('user');
   *   // => "alian:cache:v1:user:*"
   */
  namespacePrefix(namespace: string): string {
    return `${this.prefix}${this.version}:${namespace}:*`;
  }

  /**
   * Strip the version segment from an existing key, useful for legacy
   * invalidation or migration.
   */
  stripVersion(key: string): string {
    const versionPattern = new RegExp(`:${this.version}:`);
    return key.replace(versionPattern, ":");
  }

  /**
   * Produce a deterministic SHA-256 hash of the JSON-serialised arguments,
   * truncated to {@link hashLength} hex characters.
   */
  private hashArgs(args: unknown[]): string {
    const serialised = JSON.stringify(args, this.jsonReplacer);
    return createHash("sha256")
      .update(serialised)
      .digest("hex")
      .slice(0, this.hashLength);
  }

  /**
   * Custom JSON replacer that sorts object keys for determinism and
   * converts non-JSON-safe values to strings.
   */
  private jsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.source;
    if (typeof value === "function") return value.toString();
    if (typeof value === "bigint") return value.toString();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce(
          (sorted: Record<string, unknown>, k) => {
            sorted[k] = (value as Record<string, unknown>)[k];
            return sorted;
          },
          {} as Record<string, unknown>,
        );
    }
    return value;
  }
}
