import * as fs from "fs";
import * as path from "path";

/**
 * Regression guard for the `Math.random()` -> `crypto.randomUUID()` migration.
 *
 * The identifiers that were generated with `Math.random()` are not just ugly:
 * they are the members of the rate-limiter sliding-window sorted set and the
 * ids of persisted, externally visible rate-limit violation records. A
 * non-cryptographic PRNG makes those values predictable and collision-prone,
 * which is a correctness problem rather than a style one.
 *
 * This test fails the moment somebody reintroduces `Math.random()` in the
 * directories covered by the issue, so the guarantee does not depend on
 * reviewer vigilance.
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..");

/** Directories in scope, per the issue's acceptance criteria. */
const GUARDED_DIRECTORIES = [
  path.join(SRC_ROOT, "rate-limiting"),
  path.join(SRC_ROOT, "observability"),
  path.join(SRC_ROOT, "common", "middleware"),
  // The issue lists the profiling middleware/service by their pre-move paths
  // (src/common/middleware/profiling.middleware.ts and
  // src/observability/profiling.service.ts); in the current tree they live in
  // src/profiling, so that is the directory that has to stay clean.
  path.join(SRC_ROOT, "profiling"),
];

/**
 * Strip comments so the explanatory comments that *mention* `Math.random()` do
 * not trip the guard. Only executable code is interesting here.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectTypeScriptFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    });
}

describe("Math.random() is not used to build identifiers", () => {
  it.each(GUARDED_DIRECTORIES)(
    "has no Math.random() call sites in %s",
    (dir) => {
      const offenders = collectTypeScriptFiles(dir)
        .filter((file) => /Math\s*\.\s*random\s*\(/.test(stripComments(fs.readFileSync(file, "utf8"))))
        .map((file) => path.relative(SRC_ROOT, file));

      expect(offenders).toEqual([]);
    },
  );
});