module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
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
