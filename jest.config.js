module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  // Unit specs are colocated with the code they cover, so `rootDir` is `src`.
  //
  // NOTE: because rootDir is `src`, a `*.spec.ts` written anywhere else in the
  // repository matches `testRegex` below but is *never executed* - `npm test`
  // still passes, which makes the gap invisible. Tests that need the whole app
  // (supertest, TypeOrmModule.forRoot, dropSchema) belong in `test/` and must
  // use the `.e2e-spec.ts` suffix so that test/jest-e2e.json picks them up.
  // src/config/jest-project-coverage.spec.ts enforces both halves of this.
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // Some deps pulled in by @stellar/stellar-sdk (uint8array-extras, @noble/*,
    // smol-toml, eventsource) publish untranspiled ESM (`export`/`import`) in
    // their .js. Jest ignores node_modules by default (see
    // transformIgnorePatterns below); down-level just those files with an
    // isolated, no-type-check transpile so they load under CommonJS.
    '.+/node_modules/.+\\.js$': ['ts-jest', { isolatedModules: true }],
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: [
    // Keep ignoring node_modules EXCEPT the ESM-only chain under
    // @stellar/stellar-sdk, which must be transpiled to load in Jest.
    '/node_modules/(?!(@stellar|@noble|@exodus|stellar-base|uint8array-extras|smol-toml|eventsource)/)',
    '\\.pnp\\.[^\\/]+$',
  ],
  moduleNameMapper: {
    // Resolve absolute "src/..." imports (tsconfig baseUrl) under rootDir.
    '^src/(.*)$': '<rootDir>/$1',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
