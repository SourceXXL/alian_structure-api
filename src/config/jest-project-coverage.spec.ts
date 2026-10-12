import * as fs from "fs";
import * as path from "path";

/**
 * Guards the invariant behind the jest spec relocation: every `*.spec.ts` in
 * the repository is reachable by one of the configured Jest projects.
 *
 * `jest.config.js` pins `rootDir: 'src'`, so a unit spec written anywhere
 * else matches `testRegex` but is silently never executed. `npm test` passes,
 * the test count looks healthy, and the coverage gap is invisible. Five
 * specs were sitting in `test/` in exactly that state.
 *
 * This fails if a `*.spec.ts` is ever added outside `src/` without also
 * matching the e2e project's `testRegex`.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/* eslint-disable @typescript-eslint/no-var-requires */
const UNIT_CONFIG = require(path.join(REPO_ROOT, "jest.config.js"));
const E2E_CONFIG = require(path.join(REPO_ROOT, "test", "jest-e2e.json"));

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
]);

const UNIT_ROOT = path.resolve(REPO_ROOT, UNIT_CONFIG.rootDir);
const UNIT_TEST_REGEX = new RegExp(UNIT_CONFIG.testRegex);
const E2E_TEST_REGEX = new RegExp(E2E_CONFIG.testRegex);

function collectSpecs(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSpecs(entryPath, found);
    } else if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      found.push(entryPath);
    }
  }
  return found;
}

describe("jest project coverage", () => {
  it("pins the unit suite rootDir to src, so specs are colocated with the code", () => {
    // Stated explicitly because it is the reason a spec outside src/ can be
    // silently skipped: the rootDir, not the testRegex, decides what runs.
    expect(path.relative(REPO_ROOT, UNIT_ROOT)).toBe("src");
  });

  it("only finds *.spec.ts files that a configured Jest project will run", () => {
    const orphaned = collectSpecs(REPO_ROOT).filter((file) => {
      if (UNIT_TEST_REGEX.test(file) && file.startsWith(UNIT_ROOT)) return false;
      // Anything else has to be picked up by the e2e project instead.
      return !E2E_TEST_REGEX.test(file);
    });

    expect(
      orphaned.map((file) => path.relative(REPO_ROOT, file)),
    ).toEqual([]);
  });

  it("has no *.spec.ts left under test/ (e2e specs use the .e2e-spec.ts suffix)", () => {
    const testDir = path.join(REPO_ROOT, "test");
    const unitSpecs = collectSpecs(testDir).filter(
      (file) => !E2E_TEST_REGEX.test(file),
    );

    expect(unitSpecs).toEqual([]);
  });
});