# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-06-03

First release since 1.2.0. (Versions 2.x–5.x were developed but never published; this entry covers the
net changes from 1.2.0.) The API moved to native `Date` objects and an ESM-only, baked-result design.

### Changed (BREAKING)

- All date fields are now native `Date` objects (was `YYYY-MM-DD` strings), interpreted in UTC; any
  time-of-day on an input/split date is floored to UTC midnight.
- Package is **ESM-only** — use `import` (no CommonJS `require`).
- Minimum Node.js is now **>= 24** (was 20).
- `calculateCgt` throws `CgValidationError` on invalid input (no `Result<T, E>` wrapper).
- Derived values (gain, cost, tax, pool impact, per-match figures) are baked onto the result as readonly
  `@computed` fields — the `Transaction`/`Event`/`Match`/`Period`/`TaxYear` helper namespaces are gone.
- Trades dated outside the supported range (2008/09–2026/27) are rejected up front by validation.

### Added

- `getSupportInfo()` (+ `CgSupportInfo`) — the supported date range, tax-year range, and bundled HMRC
  rates/allowances, without running a calculation.
- `feesGBP` on rate-period and tax-year summaries; `reportingRequired`/`reportingReasons`; `remainingAEAGBP`.
- The bundled HMRC config (2008/09–2026/27) is now an immutable single source of truth.

### Fixed

- Annual Exempt Amount in split-rate years is allocated highest-rate-first, per HMRC ([CG21520](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg21520)).
- 2010/11 mid-year CGT rate change modelled (18% → 18%/28% on 23 June 2010, [CG10246](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg10246)).
- Same-day and bed-&-breakfast matching are applied to `transfer` disposals, not just sells.
- Calculation results no longer alias the internal HMRC config, so mutating a result can't affect later calculations.

### Removed (BREAKING)

- The AEA optimiser (`calculateOptimalSell` and its types) — the library is purely descriptive. Compute a
  suggestion from `year.remainingAEAGBP` and `year.poolAtYearEnd` if needed.
- CommonJS output and the `require` entry point.

### Migration from 1.x

- Wrap dates: `date: "2024-04-05"` → `date: new Date("2024-04-05")` (trades and split events).
- Use ESM `import` (Node >= 24).
- Read the baked `*GBP`/count fields on the result instead of calling helpers.
- Catch `CgValidationError` instead of inspecting a result wrapper.

## [1.2.0] - 2026-05-13

### Fixed

- The Annual Exempt Amount is now distributed proportionally across a tax year's rate periods (rather
  than landing entirely in one period) in split-rate years. Superseded by 3.0.0, which switched to
  HMRC's highest-rate-first allocation ([CG21520](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg21520)).

## [1.1.0] - 2026-05-13

### Fixed

- Same-day and bed-&-breakfast matching rules are now applied to `transfer` disposals, not just sells,
  so a transfer is matched against same-day/30-day acquisitions before drawing on the Section 104 pool.

## [1.0.0] - 2026-05-12

### Added

- Core CGT calculation engine implementing HMRC share matching rules
  - Same-day matching (Pass 1a)
  - Bed & breakfast 30-day rule (Pass 1b)
  - Section 104 pool average cost (Pass 2)
- Stock split support with automatic adjustment factor computation
- Foreign currency trade support with exchange rate conversion
- Transfer (no gain/no loss) disposal support
- Trade validation and normalisation via `normaliseTrades()`
- Annual Exempt Amount (AEA) optimisation via `calculateOptimalSell()`
- HMRC tax year configurations from 2008/09 to 2026/27
- CGT rate lookup including 2024/25 mid-year rate change
- Tax computation at basic and higher rates per rate period
- Pool state before/after snapshots on all events
- Pool impact tracking (shares/cost added or removed)
- Unified `Result<T, E>` return type across all public functions
- Defensive error handling with explicit map key checks
- Sort stability guarantee for same-date trades
- Input validation with structured error reporting (all errors at once)
- 100% test coverage enforced at build time
- ESM + CJS dual output with TypeScript declarations
- Zero runtime dependencies
- `no-non-null-assertion` ESLint rule enforced in source code
