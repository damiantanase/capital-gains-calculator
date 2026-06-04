// @ts-check
// StrykerJS mutation-testing config for capital-gains-calculator.
//
// Mutation testing perturbs the source (e.g. * -> /, - -> +, <= 30 -> < 30) and
// fails if no test notices. It exists because 100% line/branch coverage proves a
// line *ran*, not that its arithmetic is *correct* — a real bug (a section-104
// disposal's cost inflated by a spurious * ctx.splitFactor) once shipped at 100%
// coverage. This is delivered as the local/opt-in `npm run test:mutation` and
// `npm run build:full` commands; it is deliberately NOT in `npm run build` (which
// must stay fast — it gates publish, pack, and the website's tarball build).

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
const config = {
  // Vitest 4.x runner. Peer is `vitest >= 2.0.0`; tests import straight from ../src
  // so there is no build step to keep in sync.
  testRunner: "vitest",

  // The vitest-runner forces "perTest" and disables Vitest's own coverage reporting;
  // set explicitly for clarity and forward-compatibility.
  coverageAnalysis: "perTest",

  vitest: {
    // A Stryker-only Vitest config that omits the 100% coverage thresholds, so the
    // dry run can never fail on the publish-time coverage gate.
    configFile: "vitest.stryker.config.ts",
  },

  // Mutate runtime source only. index.ts is a pure re-export barrel and types/** is
  // type-only — neither has executable statements, so mutating them yields noise.
  mutate: ["src/**/*.ts", "!src/index.ts", "!src/types/**"],

  // Operate on a sandbox copy (inPlace stays false) — never touch the working tree.
  tempDirName: ".stryker-tmp",
  ignorePatterns: ["dist", "coverage", ".stryker-tmp", "reports", "generated"],

  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },

  // Faster local reruns. The incremental file lives under reports/ (gitignored) — it
  // is NOT committed (Stryker #6004: the vitest runner's non-deterministic test IDs
  // produce huge no-op diffs).
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",

  // high/low colour the report. `break` is the hard-fail gate (exit 1 below it).
  // Achieved score is 91.86%; break is set just below at 88 to ratchet quality
  // while tolerating the small run-to-run jitter from the vitest-runner's per-test
  // coverage attribution (see note below). Raise it as the score climbs.
  //
  // NOTE: the ~500-trade integration test (tests/mega-suite.test.ts) shares one
  // calculateCgt result across its 51 assertion `it`s, so the vitest-runner's
  // perTest coverage attributes engine lines only to the first test. Those 51
  // assertions therefore don't participate in mutation analysis, making the score
  // CONSERVATIVE — several reported survivors are in fact killed by the full suite.
  thresholds: { high: 90, low: 80, break: 88 },
};

export default config;
