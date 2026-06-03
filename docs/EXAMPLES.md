# Examples

This document contains two sections:

1. **HMRC Rule Examples** — illustrates how the HMRC share matching rules work with worked calculations
2. **Developer Examples** — shows how to integrate the library, use the output, and handle common scenarios

All examples use the real API: `calculateCgt` **throws `CgValidationError`** on invalid input, all dates are `Date` objects, and every derived value (gain, cost, tax, pool impact, reporting status, remaining AEA) is **baked onto the result as a readonly field** — you read fields, you do not call helper functions or thread a `transactions` array. Derived fields are tagged `@computed` in their JSDoc.

## Try it online

You can run these examples in the browser using [StackBlitz](https://stackblitz.com):

1. Go to [stackblitz.com/edit/node](https://stackblitz.com/edit/node)
2. Run `npm install capital-gains-calculator` in the terminal
3. Paste any example below into `index.ts`

---

# Part 1: HMRC Rule Examples

These examples demonstrate how HMRC's share identification rules determine which shares are matched to each disposal, and how gains are calculated. Based on [HMRC's Capital Gains manual (CG51560)](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg51560) and [Helpsheet HS284](https://www.gov.uk/government/publications/shares-and-capital-gains-tax-hs284-self-assessment-helpsheet).

Each example picks the first sell event out of the result and reads its baked fields:

```typescript
import { calculateCgt, type CgCalculateResult, type CgEvent } from "capital-gains-calculator";

// Helper used throughout: collect every sell event across all tax years.
function sellEvents(result: CgCalculateResult): CgEvent[] {
  return result.taxYears
    .flatMap((y) => y.periods)
    .flatMap((p) => p.events)
    .filter((e) => e.type === "sell");
}
```

## Example 1: Section 104 Pool (basic buy and sell)

The Section 104 pool tracks the average cost of all shares held. When you sell, the cost per share is the total pool cost divided by total pool shares.

**Scenario:** You buy shares on two occasions, then sell some later.

| Date | Action | Shares | Price | Cost |
|------|--------|--------|-------|------|
| 1 May 2022 | Buy | 1,000 | £4.00 | £4,000 |
| 1 Sep 2022 | Buy | 500 | £4.50 | £2,250 |
| 1 Feb 2023 | Sell | 700 | £5.20 | ? |

**Calculation:**
- Pool after buys: 1,500 shares, total cost £6,250
- Average cost per share: £6,250 / 1,500 = £4.1667
- Cost of 700 shares sold: 700 × £4.1667 = £2,916.67
- Proceeds: 700 × £5.20 = £3,640
- **Gain: £3,640 − £2,916.67 = £723.33**

Pool remaining: 800 shares, cost £3,333.33

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "XYZ", type: "buy", quantity: 1000, unitPrice: 4.0 },
  { date: new Date("2022-09-01"), symbol: "XYZ", type: "buy", quantity: 500, unitPrice: 4.5 },
  { date: new Date("2023-02-01"), symbol: "XYZ", type: "sell", quantity: 700, unitPrice: 5.2 },
]);

const disposal = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "sell")!;

console.log(disposal.matches[0].rule);     // "section-104"
console.log(disposal.costGBP.toFixed(2));  // "2916.67"
console.log(disposal.gainGBP.toFixed(2));  // "723.33"

// Pool at the end of the tax year
console.log(result.taxYears[result.taxYears.length - 1].poolAtYearEnd);
// [{ symbol: "XYZ", shares: 800, costGBP: 3333.33... }]
```

## Example 2: Same-Day Rule

If you buy and sell shares of the same company on the same day, those shares are matched first — before the Section 104 pool.

**Scenario:** You already hold 1,000 shares bought at £3.00. On the same day, you buy more and sell some.

| Date | Action | Shares | Price |
|------|--------|--------|-------|
| 1 May 2022 | Buy | 1,000 | £3.00 |
| 1 Nov 2022 | Buy | 200 | £4.80 |
| 1 Nov 2022 | Sell | 500 | £5.00 |

**Calculation:**
- Same-day rule matches the sell against the 200 shares bought on 1 Nov first
- Same-day portion: 200 shares at cost £4.80 each = £960
- Remaining 300 shares matched against Section 104 pool
- Pool (before same-day buy): 1,000 shares at £3.00 = £3,000. Cost per share: £3.00
- Pool portion: 300 × £3.00 = £900
- Total cost: £960 + £900 = £1,860
- Proceeds: 500 × £5.00 = £2,500
- **Gain: £2,500 − £1,860 = £640**

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "ABC", type: "buy", quantity: 1000, unitPrice: 3.0 },
  { date: new Date("2022-11-01"), symbol: "ABC", type: "buy", quantity: 200, unitPrice: 4.8 },
  { date: new Date("2022-11-01"), symbol: "ABC", type: "sell", quantity: 500, unitPrice: 5.0 },
]);

const disposal = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "sell")!;

const sameDay = disposal.matches.find((m) => m.rule === "same-day")!;
const pool = disposal.matches.find((m) => m.rule === "section-104")!;

console.log(sameDay.originalMatchedQuantity);  // 200
console.log(sameDay.costGBP / 200);            // 4.80 (cost per share)
console.log(pool.originalMatchedQuantity);     // 300
console.log(pool.costGBP / 300);               // 3.00 (cost per share)
console.log(disposal.gainGBP);                 // 640 (total gain across both matches)
```

## Example 3: Bed and Breakfast Rule (30-day rule)

If you sell shares and repurchase the same shares within 30 days, the sale is matched against the repurchase — not the pool. This prevents crystallising a loss by selling and immediately rebuying.

**Scenario:** You sell shares to realise a loss, then rebuy 10 days later.

| Date | Action | Shares | Price |
|------|--------|--------|-------|
| 1 Mar 2022 | Buy | 1,000 | £5.00 |
| 1 Jun 2023 | Sell | 1,000 | £3.00 |
| 11 Jun 2023 | Buy | 1,000 | £3.10 |

**Calculation:**
- B&B rule: the sell on 1 Jun is matched against the buy on 11 Jun (within 30 days)
- Cost of disposal: 1,000 × £3.10 = £3,100 (the repurchase price, not the original £5.00)
- Proceeds: 1,000 × £3.00 = £3,000
- **Loss: £3,000 − £3,100 = −£100**

The original £5,000 cost is effectively "lost" — the loss is only £100, not the £2,000 you might expect. This is the anti-avoidance rule in action.

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-03-01"), symbol: "DEF", type: "buy", quantity: 1000, unitPrice: 5.0 },
  { date: new Date("2023-06-01"), symbol: "DEF", type: "sell", quantity: 1000, unitPrice: 3.0 },
  { date: new Date("2023-06-11"), symbol: "DEF", type: "buy", quantity: 1000, unitPrice: 3.1 },
]);

const disposal = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "sell")!;

console.log(disposal.matches[0].rule);     // "bed-and-breakfast"
console.log(disposal.gainGBP.toFixed(2));  // "-100.00" (a loss)
```

## Example 4: Stock Splits

When a company does a stock split, the number of shares increases but the total cost basis stays the same. The library handles this automatically via `splitEvents`.

**Scenario:** You buy 10 shares before a 1:20 stock split, then sell some after.

| Date | Action | Shares | Price |
|------|--------|--------|-------|
| 1 Jan 2022 | Buy | 10 | £3,000 |
| 6 Jun 2022 | Split 1:20 | (10 → 200) | — |
| 1 Feb 2023 | Sell | 100 | £160 |

**Calculation:**
- After split: 200 shares, cost still £30,000 total. Cost per share: £150
- Sell 100: cost = 100 × £150 = £15,000
- Proceeds: 100 × £160 = £16,000
- **Gain: £16,000 − £15,000 = £1,000**

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt(
  [
    { date: new Date("2022-01-01"), symbol: "AMZN", type: "buy", quantity: 10, unitPrice: 3000 },
    { date: new Date("2023-02-01"), symbol: "AMZN", type: "sell", quantity: 100, unitPrice: 160 },
  ],
  {
    splitEvents: [{ date: new Date("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }],
  }
);

const disposal = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "sell")!;

console.log(disposal.quantity);            // 100 (split-adjusted)
console.log(disposal.costGBP.toFixed(2));  // "15000.00"
console.log(disposal.gainGBP.toFixed(2));  // "1000.00"
```

## Example 5: Foreign Currency Trades

When you trade in a foreign currency, the exchange rate converts both the price and fees to GBP. The `exchangeRate` field is "units of foreign currency per 1 GBP" (matching HMRC's convention).

**Scenario:** You buy US shares at $150 when £1 = $1.25, then sell at $200 when £1 = $1.30.

| Date | Action | Shares | Price (USD) | Rate | Price (GBP) |
|------|--------|--------|-------------|------|-------------|
| 1 May 2022 | Buy | 100 | $150 | 1.25 | £120 |
| 1 Feb 2023 | Sell | 100 | $200 | 1.30 | £153.85 |

**Calculation:**
- Cost: 100 × $150 / 1.25 = £12,000
- Proceeds: 100 × $200 / 1.30 = £15,384.62
- **Gain: £15,384.62 − £12,000 = £3,384.62**

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: new Date("2023-02-01"), symbol: "AAPL", type: "sell", quantity: 100, unitPrice: 200, exchangeRate: 1.30 },
]);

const disposal = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "sell")!;

console.log(disposal.valueGBP.toFixed(2)); // "15384.62" (net proceeds)
console.log(disposal.costGBP.toFixed(2));  // "12000.00"
console.log(disposal.gainGBP.toFixed(2));  // "3384.62"
```

## Example 6: Transfers (gifting to a spouse)

A transfer represents shares leaving your portfolio without a market sale — typically a gift to a spouse or civil partner. Under HMRC rules, transfers between spouses are treated as "no gain, no loss" disposals. The shares leave your Section 104 pool at their average cost.

**Scenario:** You hold 1,000 shares and transfer 400 to your spouse.

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "VOD", type: "buy", quantity: 1000, unitPrice: 1.2 },
  { date: new Date("2023-03-01"), symbol: "VOD", type: "transfer", quantity: 400, unitPrice: 1.2, allowableExpenditure: 5 },
]);

const transfer = result.taxYears
  .flatMap((y) => y.periods)
  .flatMap((p) => p.events)
  .find((e: CgEvent) => e.type === "transfer")!;

console.log(transfer.gainGBP);     // 0 (no gain, no loss — transfers always return 0)
console.log(transfer.valueGBP);    // 0 (no taxable proceeds for a spouse transfer)
console.log(transfer.feesGBP);     // 5 (the fee you paid — recorded for display, does not affect the gain)
console.log(transfer.poolImpact);  // { sharesDelta: -400, costDeltaGBP: -480 } (400 × £1.20)

// Your remaining pool at year end
console.log(result.taxYears[result.taxYears.length - 1].poolAtYearEnd);
// [{ symbol: "VOD", shares: 600, costGBP: 720 }]
```

The `unitPrice` on a transfer is recorded for reference, but the gain is always zero because the cost is taken from the pool. Any `allowableExpenditure` you pass is surfaced on `feesGBP` (and included in the year's `feesGBP` total) for display, but it does not change the no-gain/no-loss result.

## Example 7: Annual Exempt Amount

Each tax year has a tax-free allowance (Annual Exempt Amount). Gains up to this amount are not taxable. Both the allowance and the remaining allowance are on the year summary.

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2023-05-01"), symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 50 },
  { date: new Date("2024-01-01"), symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 90 },
]);

const year = result.taxYears[0];
console.log(year.taxYear);                       // "2023/24"
console.log(year.netGainGBP.toFixed(2));         // "4000.00"
console.log(year.limits.annualExemptAmount);     // 6000
console.log(year.taxableGainGBP.toFixed(2));     // "0.00" (gain within AEA)
console.log(year.remainingAEAGBP.toFixed(2));    // "2000.00" (6000 - 4000)
```

---

# Part 2: Developer Examples

## Integrating the Library

### Basic Integration

```typescript
import { calculateCgt, CgValidationError, type CgTradeInput, type CgCalculateResult } from "capital-gains-calculator";

// Your trades from a database, CSV, or API
const trades: CgTradeInput[] = [
  { date: new Date("2022-05-01"), symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: new Date("2023-01-15"), symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 180, exchangeRate: 1.22 },
];

try {
  const result: CgCalculateResult = calculateCgt(trades);
  // Read result.taxYears (with baked totals) + result.normalisedTransactions...
} catch (err) {
  if (err instanceof CgValidationError) {
    // err.errors is a CgValidationDetail[] — one entry per problem
    console.error(err.errors);
  } else {
    throw err;
  }
}
```

### With Stock Splits

```typescript
import { calculateCgt, type CgSplitEvent, type CgTradeInput } from "capital-gains-calculator";

const trades: CgTradeInput[] = [
  { date: new Date("2022-01-01"), symbol: "AMZN", type: "buy", quantity: 10, unitPrice: 3000 },
  { date: new Date("2023-02-01"), symbol: "AMZN", type: "sell", quantity: 100, unitPrice: 160 },
];

const splitEvents: CgSplitEvent[] = [
  { date: new Date("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
  { date: new Date("2022-07-18"), symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
];

const result = calculateCgt(trades, { splitEvents });
// Use result...
```

## Validating Trades

There is no separate validation step — `calculateCgt` validates as it runs and throws `CgValidationError` with every problem collected in `.errors`. Catch it to surface issues to the user:

```typescript
import { calculateCgt, CgValidationError } from "capital-gains-calculator";

try {
  calculateCgt([
    { date: new Date("2023-01-01"), symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
    { date: new Date("2007-01-01"), symbol: "OLD", type: "buy", quantity: 10, unitPrice: 50 }, // before 2008/09
    { date: new Date("2023-06-01"), symbol: "AAPL", type: "sell", quantity: 200, unitPrice: 180 }, // oversell
  ]);
} catch (err) {
  if (err instanceof CgValidationError) {
    for (const detail of err.errors) {
      console.log(`trade #${detail.index}: ${detail.field} — ${detail.message}`);
    }
    // e.g. "trade #1: date — Trades before 6 April 2008 are not supported (pre-2008/09 tax year)"
  }
}
```

Validation covers: valid `Date` objects, no trades before 2008/09 or past the latest supported tax year (currently 2026/27), positive quantities, non-negative prices/fees, positive exchange rates, and position checks (you cannot sell or transfer more than the accumulated holding to that date).

### Inspecting normalised transactions

A successful result also exposes the merged, sorted, GBP-denominated transactions:

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2023-01-01"), symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: new Date("2023-06-01"), symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 180, exchangeRate: 1.22 },
]);

const first = result.normalisedTransactions[0];
console.log(first.valueGBP.toFixed(2)); // "12000.00" (100 × 150 / 1.25)
console.log(first.quantity);            // 100 (split-adjusted)
console.log(first.feesGBP);             // 0
console.log(first.inputIndices);        // [0] — which input trades were merged into this one
```

## Working with the Output

### Iterating Tax Year Summaries

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2023-05-01"), symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 50 },
  { date: new Date("2024-01-01"), symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 90 },
]);

for (const year of result.taxYears) {
  console.log(`--- ${year.taxYear} ---`);
  console.log(`Gains:    £${year.gainsGBP.toFixed(2)}`);
  console.log(`Losses:   £${year.lossesGBP.toFixed(2)}`);
  console.log(`Net:      £${year.netGainGBP.toFixed(2)}`);
  console.log(`Fees:     £${year.feesGBP.toFixed(2)}`); // total commissions (buys + sells + transfers)
  console.log(`AEA:      £${year.limits.annualExemptAmount}`);
  console.log(`Taxable:  £${year.taxableGainGBP.toFixed(2)}`);
  console.log(`Report?:  ${year.reportingRequired ? `yes (${year.reportingReasons.join(", ")})` : "no"}`);
}
```

### Inspecting Disposal Matching Details

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "ABC", type: "buy", quantity: 1000, unitPrice: 3.0 },
  { date: new Date("2022-11-01"), symbol: "ABC", type: "buy", quantity: 200, unitPrice: 4.8 },
  { date: new Date("2022-11-01"), symbol: "ABC", type: "sell", quantity: 500, unitPrice: 5.0 },
]);

for (const year of result.taxYears) {
  for (const period of year.periods) {
    for (const disposal of period.events.filter((e: CgEvent) => e.type === "sell")) {
      console.log(`Sold ${disposal.quantity} ${disposal.symbol}`);
      console.log(`  Proceeds: £${disposal.valueGBP.toFixed(2)}`);
      console.log(`  Cost:     £${disposal.costGBP.toFixed(2)}`);
      console.log(`  Gain:     £${disposal.gainGBP.toFixed(2)}`);

      for (const match of disposal.matches) {
        console.log(`  ${match.rule}: ${match.originalMatchedQuantity} shares, cost £${match.costGBP.toFixed(2)}`);
        if (match.matchedDate) console.log(`    against acquisition on ${match.matchedDate.toISOString().slice(0, 10)}`);
      }

      const impact = disposal.poolImpact;
      console.log(impact ? `  Pool: ${impact.sharesDelta} shares, £${impact.costDeltaGBP.toFixed(2)}` : "  Pool: unchanged");
    }
  }
}
```

### Tracking Acquisitions

Buy events appear in the same `period.events` array; a buy's `matches` show where its shares went (consumed same-day / B&B by a later disposal, or added to the Section 104 pool).

```typescript
import { calculateCgt, type CgEvent } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "ABC", type: "buy", quantity: 1000, unitPrice: 3.0 },
]);

for (const year of result.taxYears) {
  for (const period of year.periods) {
    for (const acquisition of period.events.filter((e: CgEvent) => e.type === "buy")) {
      console.log(`Bought ${acquisition.quantity} ${acquisition.symbol} for £${acquisition.valueGBP.toFixed(2)}`);
      for (const m of acquisition.matches) {
        console.log(`  ${m.originalMatchedQuantity} shares → ${m.rule === "section-104" ? "added to pool" : `matched (${m.rule})`}`);
      }
      const impact = acquisition.poolImpact;
      if (impact) console.log(`  Pool: +${impact.sharesDelta} shares, +£${impact.costDeltaGBP.toFixed(2)}`);
    }
  }
}
```

### Reading Pool State

Each tax year carries its pool state at year end:

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2022-05-01"), symbol: "XYZ", type: "buy", quantity: 1000, unitPrice: 4.0 },
]);

for (const year of result.taxYears) {
  console.log(`\n${year.taxYear}:`);
  for (const pool of year.poolAtYearEnd) {
    const avg = pool.costGBP / pool.shares;
    console.log(`  ${pool.symbol}: ${pool.shares} shares, £${pool.costGBP.toFixed(2)}, avg £${avg.toFixed(2)}/share`);
  }
}
```

## Tax Rates and Reporting

CGT rates are recorded on each rate period of a tax year. A year with a mid-year rate change (e.g. 2024/25) has more than one period.

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: new Date("2024-05-01"), symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 50 },
  { date: new Date("2025-02-01"), symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 200 },
]);

const year = result.taxYears.find((y) => y.taxYear === "2024/25")!;
for (const period of year.periods) {
  const from = period.period.from.toISOString().slice(0, 10);
  const to = period.period.to.toISOString().slice(0, 10);
  console.log(`${from}–${to}: basic ${period.period.basicRate}%, higher ${period.period.higherRate}%`);
}
// 2024-04-06–2024-10-29: basic 10%, higher 20%
// 2024-10-30–2025-04-05: basic 18%, higher 24%

// Whether HMRC reporting is required, and why:
console.log(year.reportingRequired);  // true
console.log(year.reportingReasons);   // e.g. ["taxable-gain"] or ["proceeds-exceed-threshold"]
console.log(year.limits.reportingThreshold); // 50000
```

## Supported Range, Rates, and Allowances (without a calculation)

`getSupportInfo()` exposes the bundled HMRC data so you can validate input or look things up before (or instead of) running a calculation — for example to bound a date-picker, reject out-of-range trades early, or display the CGT rate and Annual Exempt Amount for a given date. The returned object is a fresh deep copy, so it is safe to read and mutate.

```typescript
import { getSupportInfo } from "capital-gains-calculator";

const info = getSupportInfo();

// 1. Supported trade-date range (calculateCgt throws for dates outside it).
console.log(info.minDate.toISOString().slice(0, 10)); // 2008-04-06
console.log(info.maxDate.toISOString().slice(0, 10)); // 2027-04-05
console.log(`${info.earliestTaxYear} to ${info.latestTaxYear}`); // 2008/09 to 2026/27

// Guard input before calculating:
function isSupported(tradeDate: Date): boolean {
  return tradeDate >= info.minDate && tradeDate <= info.maxDate;
}
console.log(isSupported(new Date("2007-01-01"))); // false

// 2. Look up the CGT rate that applies on a date — no calculation needed.
const date = new Date("2025-06-01");
const taxYear = info.taxYears.find((y) =>
  y.ratePeriods.some((p) => date >= p.from && date <= p.to)
);
const period = taxYear?.ratePeriods.find((p) => date >= p.from && date <= p.to);
console.log(`${taxYear?.taxYear}: ${period?.basicRate}% / ${period?.higherRate}%`); // 2025/26: 18% / 24%

// 3. Read a year's Annual Exempt Amount and reporting threshold.
const y2024 = info.taxYears.find((y) => y.taxYear === "2024/25");
console.log(y2024?.limits.annualExemptAmount); // 3000
console.log(y2024?.limits.reportingThreshold); // 50000
```

## Building a Timeline View

Combine every event (buys, sells, transfers) and split events into a chronological timeline:

```typescript
import { calculateCgt, type CgSplitEvent, type CgEvent } from "capital-gains-calculator";

const splitEvents: CgSplitEvent[] = [
  { date: new Date("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
];

const result = calculateCgt(
  [
    { date: new Date("2022-01-01"), symbol: "AMZN", type: "buy", quantity: 10, unitPrice: 3000 },
    { date: new Date("2023-02-01"), symbol: "AMZN", type: "sell", quantity: 100, unitPrice: 160 },
  ],
  { splitEvents }
);

type TimelineEntry =
  | { kind: "event"; date: Date; event: CgEvent }
  | { kind: "split"; date: Date; split: CgSplitEvent };

const timeline: TimelineEntry[] = [];
for (const year of result.taxYears) {
  for (const period of year.periods) {
    for (const event of period.events) timeline.push({ kind: "event", date: event.date, event });
  }
}
for (const split of splitEvents) timeline.push({ kind: "split", date: split.date, split });

timeline.sort((a, b) => a.date.getTime() - b.date.getTime());

for (const entry of timeline) {
  const day = entry.date.toISOString().slice(0, 10);
  if (entry.kind === "split") {
    console.log(`${day} SPLIT ${entry.split.symbol} ${entry.split.ratioFrom}:${entry.split.ratioTo}`);
  } else if (entry.event.type === "sell") {
    console.log(`${day} SELL ${entry.event.symbol} | Gain: £${entry.event.gainGBP.toFixed(2)}`);
  } else {
    console.log(`${day} ${entry.event.type.toUpperCase()} ${entry.event.symbol} ${entry.event.quantity}`);
  }
}
```
