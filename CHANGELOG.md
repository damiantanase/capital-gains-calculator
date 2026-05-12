# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
