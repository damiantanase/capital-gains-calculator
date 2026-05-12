# capital-gains-calculator

UK Capital Gains Tax calculator implementing HMRC share matching rules.

> **Disclaimer:** This library is provided for informational and educational purposes only. It does not constitute tax, legal, or financial advice. While the calculations aim to follow HMRC's published share matching rules, the authors make no guarantees about accuracy or completeness. Always verify your capital gains calculations with a qualified tax professional before filing your tax return.

> **Try it in the browser:** This library powers [capitalgainscalculator.app](https://capitalgainscalculator.app) — a free web UI for calculating UK capital gains on shares.

## Features

- Section 104 pool (average cost basis)
- Same-day matching rule
- Bed & breakfast rule (30-day rule)
- Stock split adjustments (auto-computed from split events)
- Annual Exempt Amount (AEA) optimisation
- Trade validation and normalisation
- Grouped by UK tax year (April 6 – April 5)
- HMRC allowances and rates bundled (2008/09 – 2026/27)
- Zero runtime dependencies
- TypeScript-first with full type exports
- 100% test coverage enforced at build time

## Install

```bash
npm install capital-gains-calculator
```

Requires Node.js >= 20.

## Quick Start

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2023-01-15", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.22 },
  { date: "2023-06-20", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 180, exchangeRate: 1.27 },
  { date: "2024-02-10", symbol: "AAPL", type: "sell", quantity: 80, unitPrice: 200, exchangeRate: 1.26 },
]);

if (!result.ok) {
  console.error("Validation errors:", result.errors);
} else {
  for (const year of result.data.taxYears) {
    console.log(`${year.taxYear}: gain £${year.totalGains.toFixed(2)}, taxable £${year.taxableGain.toFixed(2)}`);
  }
}
```

For comprehensive worked examples (HMRC rule illustrations and developer integration patterns), see [EXAMPLES.md](./EXAMPLES.md).

## API

### `calculateCgt(trades, options?)`

Calculates capital gains tax across all trades, applying HMRC matching rules and grouping results by tax year.

- `trades` — Array of `CgtTradeInput` objects
- `options.allowances` — Optional `Record<string, number>` of tax year to AEA override (defaults to bundled HMRC values)
- `options.splitEvents` — Optional `SplitEvent[]` for stock split adjustments
- `options.skipValidation` — Skip input validation (default: `false`). Set to `true` only if inputs are pre-validated via `normaliseTrades`.

Returns `Result<CgtResult, ValidationError>` — a discriminated union. Check `result.ok` before accessing data:

- `result.ok === true` → `result.data` contains the `CgtResult`
- `result.ok === false` → `result.errors` contains all validation errors

The `CgtResult` includes per-tax-year summaries, individual disposal matching breakdowns, acquisition dispositions, pool state before/after each event, and pool impact details.

### `normaliseTrades(trades, options?)`

Validates and normalises raw trade inputs into sorted, merged, GBP-denominated transactions.

- `options.splitEvents` — Stock split events for quantity adjustment
- `options.skipInvalid` — When `true`, invalid trades are removed and valid ones are still returned alongside errors. When `false` (default), any validation error returns errors immediately.

Returns `Result<NormaliseResult, ValidationError>`:

- `result.ok === true` → `result.data` contains `{ transactions, errors }` (errors are present when `skipInvalid` was used)
- `result.ok === false` → `result.errors` contains all validation errors

Validation includes: no trades before 2008/09, positive quantities, non-negative prices/fees, positive exchange rates, and position checks (cannot sell more than accumulated).

### `calculateOptimalSell(params)`

Determines the optimal number of shares to sell to utilise the remaining Annual Exempt Amount.

- `params.symbol` — Stock ticker
- `params.currentPrice` — Current market price in trade currency
- `params.exchangeRate` — Units of trade currency per 1 GBP
- `params.poolCostPerShare` — Section 104 pool average cost per share in GBP
- `params.poolShares` — Shares currently in the pool
- `params.remainingAEA` — Remaining Annual Exempt Amount in GBP
- `params.allowFractional` — Whether fractional shares are allowed (default: `false`)
- `params.tolerance` — How close to full AEA usage counts as success (default: `0.05` = 5%)

Returns `Result<OptimiseResult, OptimiseValidationError>`:

- `result.ok === true` → `result.data` contains the `OptimiseResult` with `status`:
  - `"success"` — AEA used within tolerance
  - `"partial"` — couldn't use enough AEA (with `reason` explaining why)
  - `"loss"` — stock would realise a loss (with `lossPerShare`)
  - `"impossible"` — cannot sell even one share at a gain
- `result.ok === false` → `result.errors` contains validation errors

### `getDefaultAllowances()`

Returns the bundled HMRC annual exempt amounts for all supported tax years (2008/09 – 2026/27).

### `getRatesForDate(date)`

Returns the applicable CGT rate band (basic/higher) for a disposal on a given date. Handles the 2024/25 mid-year rate change (30 October 2024).

### `getTaxYearForDate(date)`

Returns the UK tax year string (e.g. `"2023/24"`) for a given date, accounting for the April 6 boundary.

### `getTaxYearConfig(taxYear)` / `getAllTaxYearConfigs()`

Returns the full tax year configuration including rates, AEA, and reporting thresholds. Returns `undefined` if the tax year is not configured.

### `validateOptimiseParams(params)`

Validates `calculateOptimalSell` parameters independently without running the optimisation. Returns an array of `OptimiseValidationError` objects (empty if valid).

### `getReportingThresholds()`

Returns a `Record<string, number>` of HMRC reporting thresholds per tax year. If total proceeds exceed the threshold, the disposal must be reported even if no tax is owed.

### `getAllTaxYears()`

Returns all supported tax year strings (e.g., `["2008/09", "2009/10", ...]`) in sorted order.

### `getCurrentTaxYear()`

Returns the current UK tax year string based on today's date. Note: this is the only impure function in the library (uses `Date.now()`).

## Types

All public functions return a `Result<T, E>` discriminated union:

```typescript
type Result<T, E> = { ok: true; data: T } | { ok: false; errors: E[] };
```

```typescript
interface CgtTradeInput {
  id?: number;                    // Auto-assigned if omitted
  date: string;                   // ISO date (YYYY-MM-DD)
  type: "buy" | "sell" | "transfer";
  symbol: string;                 // Stock ticker
  quantity: number;               // Number of shares
  unitPrice: number;              // Price per share in trade currency
  allowableExpenditure?: number;  // Fees/commission in trade currency (default: 0)
  exchangeRate?: number;          // Units of trade currency per 1 GBP (default: 1)
}

interface SplitEvent {
  date: string;                   // Date split took effect
  symbol: string;
  ratioFrom: number;              // e.g. 1
  ratioTo: number;                // e.g. 20 (for a 1:20 split)
}

interface CgtResult {
  taxYears: CgtTaxYearSummary[];  // Per-year summaries with disposals & acquisitions
  pools: Section104Pool[];        // Current pool state per symbol
  poolSnapshots: Record<string, Section104Pool[]>;
  splitEvents: SplitEvent[];
  normalisedTrades: NormalisedTransaction[];
}
```

## Limitations

- **Stocks and shares only** — this calculator handles listed securities (shares, ETFs, funds). It does not cover residential property, carried interest, or other asset classes which have different CGT rates and rules.
- **Tax years from 2008/09 onwards** — the current CGT regime (flat/two-tier rates with Section 104 pooling) was introduced on 6 April 2008. Trades before this date are not supported. The previous system used taper relief and indexation allowance, which this library does not implement.
- **Does not calculate tax owed** — the library computes gains, losses, and taxable amounts, but does not determine the actual tax liability. That depends on the taxpayer's income tax band, which is outside the scope of this calculator.
- **No Business Asset Disposal Relief (BADR)** — formerly Entrepreneurs' Relief. This applies to qualifying business disposals at a 10% rate and is not modelled.
- **No loss carry-forward** — losses from prior tax years that could offset current gains are not automatically tracked across separate calculations.
- **Transfers are spouse/civil-partner only** — transfer trades are modelled as no-gain/no-loss disposals (per TCGA 1992 s58). Connected party disposals at market value are not supported.
- **Limited corporate actions** — stock splits are supported via `splitEvents`. Other corporate actions (mergers, demergers, takeovers, rights issues, bonus issues, share-for-share exchanges) are not modelled.
- **No account type awareness** — the bed & breakfast rule applies regardless of where the repurchase occurs (ISA, pension, etc.), but the library has no concept of account wrappers.
- **AEA allocation in split-rate years** — for 2024/25 (where rates changed on 30 October 2024), the Annual Exempt Amount is applied chronologically across rate periods. In some cases, applying AEA to the higher-rate period first would minimise tax — this optimisation is not currently implemented.
- **Floating-point precision** — monetary values use IEEE 754 double-precision arithmetic. This provides more than sufficient precision for personal portfolios, but cumulative rounding over thousands of trades may produce sub-penny differences. The library outputs raw precision; consumers should round to the nearest penny for HMRC reporting.

## How it works

The calculator implements HMRC's share identification rules as specified in their Capital Gains manual (CG51560 onwards). When shares are sold, the matching algorithm determines which acquisitions the disposal is matched against, which in turn determines the allowable cost.

**Same-day rule:** Any shares acquired on the same day as the disposal are matched first. This prevents "bed and breakfasting" within the same day and ensures that the actual cost of same-day purchases is used rather than the pooled average.

**Bed and breakfast rule (30-day rule):** After same-day matching, the disposal is matched against any shares of the same class acquired within 30 days following the disposal date. This anti-avoidance rule prevents investors from selling shares to crystallise a loss and immediately repurchasing them. Matching is done on a first-in-first-out basis within the 30-day window.

**Section 104 pool:** Any remaining unmatched shares are matched against the Section 104 holding, which is a single pooled holding that tracks the average cost of all shares not already matched by the above rules. The pool is adjusted for each acquisition and part-disposal, and stock splits modify the quantity without changing the total cost.

For more detail, see [HMRC's guidance on share identification rules](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg51560).

## Development

```bash
npm install
npm test              # Run tests
npm run build         # Typecheck + lint + 100% coverage + bundle
npm run lint          # ESLint (strict TypeScript rules)
npm run format        # Prettier auto-format
npm run format:check  # Check formatting (CI)
```

The build fails if any of these gates fail:
- TypeScript strict mode type checking
- ESLint with `typescript-eslint/strict`
- 100% code coverage (statements, branches, functions, lines)

## License

MIT
