# capital-gains-calculator

UK Capital Gains Tax calculator implementing HMRC share matching rules.

> **Disclaimer:** This library is provided for informational and educational purposes only. It does not constitute tax, legal, or financial advice. While the calculations aim to follow HMRC's published share matching rules, the authors make no guarantees about accuracy or completeness. Always verify your capital gains calculations with a qualified tax professional before filing your tax return.

> **Try it in the browser:** This library powers [capitalgainscalculator.app](https://capitalgainscalculator.app) — a free web UI for calculating UK capital gains on shares.

## Features

- Section 104 pool (average cost basis)
- Same-day matching rule
- Bed & breakfast rule (30-day rule)
- Stock split adjustments (auto-computed from split events)
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

Requires Node.js >= 24. This package is **ESM-only** — use `import` (CommonJS `require` is not
supported; from CJS, use a dynamic `import()`).

## Quick Start

```typescript
import { calculateCgt, CgValidationError } from "capital-gains-calculator";

try {
  const result = calculateCgt([
    { date: new Date("2023-01-15"), symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.22 },
    { date: new Date("2023-06-20"), symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 180, exchangeRate: 1.27 },
    { date: new Date("2024-02-10"), symbol: "AAPL", type: "sell", quantity: 80, unitPrice: 200, exchangeRate: 1.26 },
  ]);

  for (const year of result.taxYears) {
    console.log(`${year.taxYear}: net £${year.netGainGBP.toFixed(2)}, taxable £${year.taxableGainGBP.toFixed(2)}`);
  }
} catch (err) {
  if (err instanceof CgValidationError) {
    console.error("Validation errors:", err.errors);
  } else {
    throw err;
  }
}
```

> **Note on dates:** all date fields are JavaScript `Date` objects. `new Date("2023-01-15")` parses as UTC midnight per the ISO-date spec, which is what the library expects (it reads only the UTC year/month/day).

> **Note on gains:** every derived value — gain, cost, tax, pool impact, reporting status, remaining AEA — is computed once by the engine and **baked onto the result as readonly fields** (e.g. `year.netGainGBP`, `event.gainGBP`, `match.costGBP`). You read fields; there are no helper functions to call and no `transactions` array to thread through. Fields carrying a derived value are marked with a `@computed` JSDoc tag documenting their formula.

For comprehensive worked examples (HMRC rule illustrations and developer integration patterns), see [EXAMPLES.md](./docs/EXAMPLES.md).

## API

### `calculateCgt(trades, options?)`

Calculates capital gains across all trades, applying HMRC matching rules and grouping results by tax year.

- `trades` — Array of `CgTradeInput` objects
- `options.splitEvents` — Optional `CgSplitEvent[]` for stock split adjustments

**Throws `CgValidationError`** if any input is invalid (bad dates, non-positive quantities, negative prices/fees, non-positive exchange rates, or selling/transferring more than the accumulated position). The thrown error's `.errors` property is a `CgValidationDetail[]` listing every problem (`{ index, field, message }`).

Returns a `CgCalculateResult`:

- `taxYears` — per-tax-year summaries (most recent first), each with its rate periods, the events that fall in them, and baked totals (`netGainGBP`, `taxableGainGBP`, `taxBasicGBP`, …)
- `normalisedTransactions` — the merged, sorted, GBP-denominated transactions

Gains, costs, tax, pool impact, reporting status, and remaining AEA are **baked onto the result as readonly fields** — see [Reading gains and tax](#reading-gains-and-tax).

### `getTaxYearForDate(date)`

Returns the UK tax year string (e.g. `"2023/24"`) for a given `Date`, accounting for the 6 April boundary.

### `getCurrentTaxYear()`

Returns the current UK tax year string based on today's date. Note: this is the only impure function in the library (it reads the system clock). `calculateCgt` itself is pure.

### `getSupportInfo()`

Returns the HMRC data the library supports, without running a calculation — useful for validating input up front (e.g. bounding a date-picker), looking up the CGT rate for a date, or reading a year's Annual Exempt Amount. Returns a `CgSupportInfo`:

- `minDate` / `maxDate` — the earliest and latest trade dates `calculateCgt` accepts (currently `2008-04-06` to `2027-04-05`). Trades outside this range throw `CgValidationError`.
- `earliestTaxYear` / `latestTaxYear` — the supported tax-year range as `"YYYY/YY"` strings (currently `"2008/09"` to `"2026/27"`).
- `taxYears` — every supported year's `CgTaxYearConfig` (`limits` + `ratePeriods`), ascending by year.

The returned object is a fresh deep copy; mutating it never affects the library.

```typescript
import { getSupportInfo } from "capital-gains-calculator";

const { minDate, maxDate, taxYears } = getSupportInfo();
console.log(`Supported trade dates: ${minDate.toISOString().slice(0, 10)} to ${maxDate.toISOString().slice(0, 10)}`);

// Look up the CGT rate that applies on a given date — no calculation needed.
const date = new Date("2025-06-01");
const year = taxYears.find((y) => y.ratePeriods.some((p) => date >= p.from && date <= p.to));
const period = year?.ratePeriods.find((p) => date >= p.from && date <= p.to);
if (period) {
  console.log(`${year?.taxYear}: ${period.basicRate}% basic / ${period.higherRate}% higher`);
}
```

### Reading gains and tax

Every derived value is a readonly field on the result — no functions to call, no `transactions` to thread. Fields carrying a derived value are marked `@computed` in their JSDoc.

- **`CgTaxYearSummary`** — `proceedsGBP`, `costsGBP`, `feesGBP`, `gainsGBP`, `lossesGBP`, `netGainGBP`, `taxableGainGBP`, `taxBasicGBP`, `taxHigherGBP`, `disposalCount`, `acquisitionCount`, `reportingRequired`, `reportingReasons`, `remainingAEAGBP`, plus `limits` and `poolAtYearEnd`
- **`CgRatePeriodSummary`** — the same money/count fields at rate-period granularity, plus `allocatedAEA`
- **`CgEvent`** — `quantity`, `costGBP`, `gainGBP`, `poolImpact`, plus `matches`, `poolBefore`, `poolAfter`
- **`CgMatch`** — `costGBP`, `gainGBP`, `matchedDate` (the last undefined for section-104), plus `rule` and `originalMatchedQuantity`
- **`CgNormalisedTransaction`** — `quantity` (split-adjusted), plus the raw trade fields

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2023-05-01"), symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 50 },
  { date: new Date("2024-01-01"), symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 90 },
]);

for (const year of result.taxYears) {
  console.log(year.taxYear, "taxable:", year.taxableGainGBP.toFixed(2));
  for (const period of year.periods) {
    console.log(`  ${period.period.basicRate}/${period.period.higherRate}%:`,
      "net", period.netGainGBP.toFixed(2));
  }
}
```

To check whether a year must be reported to HMRC, read `year.reportingRequired` (and `year.reportingReasons` for the `"taxable-gain"` / `"proceeds-exceed-threshold"` codes). `year.remainingAEAGBP` reports the Annual Exempt Amount still available after offsetting the year's net gain.

## Types

Public types use the `Cg` prefix. Invalid input throws `CgValidationError` rather than returning an error value.

```typescript
interface CgTradeInput {
  date: Date;                     // UTC; from 2008-04-06 to the last day of the latest supported tax year (currently 2027-04-05)
  type: "buy" | "sell" | "transfer";
  symbol: string;                 // Stock ticker (case-sensitive)
  quantity: number;               // Number of shares (positive)
  unitPrice: number;              // Price per share in trade currency
  allowableExpenditure?: number;  // Fees/commission in trade currency (default: 0)
  exchangeRate?: number;          // Units of trade currency per 1 GBP (default: 1)
}

interface CgSplitEvent {
  date: Date;                     // Date the split took effect (UTC)
  symbol: string;
  ratioFrom: number;              // e.g. 1
  ratioTo: number;                // e.g. 20 (for a 1:20 split)
}

interface CgCalculateOptions {
  splitEvents?: CgSplitEvent[];   // Stock split adjustments
}

interface CgCalculateResult {
  taxYears: CgTaxYearSummary[];          // Per-year summaries, most recent first
  normalisedTransactions: CgNormalisedTransaction[]; // Merged/sorted/GBP transactions
}

class CgValidationError extends Error {
  readonly errors: CgValidationDetail[]; // { index, field, message } per problem
}
```

Each `CgTaxYearSummary` carries `{ taxYear, limits, periods, poolAtYearEnd }` plus the baked totals (`netGainGBP`, `taxableGainGBP`, `reportingRequired`, `remainingAEAGBP`, …); each `CgRatePeriodSummary` carries `{ period, allocatedAEA, events }` plus the same money/count fields; each `CgEvent` carries `matches`, `poolBefore`, `poolAfter`, and the baked `quantity`/`costGBP`/`gainGBP`/`poolImpact`. See [Reading gains and tax](#reading-gains-and-tax). Every field is documented with JSDoc (derived fields tagged `@computed`) in the published type declarations.

## Limitations

- **Stocks and shares only** — this calculator handles listed securities (shares, ETFs, funds). It does not cover residential property, carried interest, or other asset classes which have different CGT rates and rules.
- **Tax years 2008/09 to 2026/27** — the current CGT regime (flat/two-tier rates with Section 104 pooling) was introduced on 6 April 2008. Trades before this date are not supported (the previous system used taper relief and indexation allowance, which this library does not implement). Trades dated in a tax year after the latest bundled year (currently 2026/27) are also rejected until the HMRC config is extended.
- **Does not calculate tax owed** — the library computes gains, losses, and taxable amounts, but does not determine the actual tax liability. That depends on the taxpayer's income tax band, which is outside the scope of this calculator.
- **No Business Asset Disposal Relief (BADR)** — formerly Entrepreneurs' Relief. This applies to qualifying business disposals at a 10% rate and is not modelled.
- **No loss carry-forward** — losses from prior tax years that could offset current gains are not automatically tracked across separate calculations.
- **Transfers are spouse/civil-partner only** — transfer trades are modelled as no-gain/no-loss disposals (per TCGA 1992 s58). Connected party disposals at market value are not supported.
- **Limited corporate actions** — stock splits are supported via `splitEvents`. Other corporate actions (mergers, demergers, takeovers, rights issues, bonus issues, share-for-share exchanges) are not modelled.
- **No account type awareness** — the bed & breakfast rule applies regardless of where the repurchase occurs (ISA, pension, etc.), but the library has no concept of account wrappers.
- **AEA allocation in split-rate years** — for 2024/25 (where rates changed on 30 October 2024), the Annual Exempt Amount and any cross-period losses are set against the gains charged at the **highest rate first**, per HMRC's "most beneficial to the taxpayer" rule ([CG21520](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg21520)). The year-level taxable gain is unaffected by the split; only which rate band each portion falls into changes. HMRC also permits a taxpayer to choose a different allocation — the library always applies the highest-rate-first default.
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
