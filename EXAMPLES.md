# Examples

This document contains two sections:

1. **HMRC Rule Examples** — illustrates how the HMRC share matching rules work with worked calculations
2. **Developer Examples** — shows how to integrate the library, use the output, and handle common scenarios

## Try it online

You can run these examples in the browser using [StackBlitz](https://stackblitz.com):

1. Go to [stackblitz.com/edit/node](https://stackblitz.com/edit/node)
2. Run `npm install capital-gains-calculator` in the terminal
3. Paste any example below into `index.ts`

---

# Part 1: HMRC Rule Examples

These examples demonstrate how HMRC's share identification rules determine which shares are matched to each disposal, and how gains are calculated. Based on [HMRC's Capital Gains manual (CG51560)](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg51560) and [Helpsheet HS284](https://www.gov.uk/government/publications/shares-and-capital-gains-tax-hs284-self-assessment-helpsheet).

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
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2022-05-01", symbol: "XYZ", type: "buy", quantity: 1000, unitPrice: 4.0 },
  { date: "2022-09-01", symbol: "XYZ", type: "buy", quantity: 500, unitPrice: 4.5 },
  { date: "2023-02-01", symbol: "XYZ", type: "sell", quantity: 700, unitPrice: 5.2 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const disposal = result.data.taxYears[0].disposals[0];
console.log(disposal.matches[0].rule);           // "section-104"
console.log(disposal.matches[0].costPerShareGBP); // ~4.1667
console.log(disposal.gainGBP);                    // ~723.33
console.log(disposal.poolImpact);                 // { symbol: "XYZ", sharesRemoved: 700, costRemoved: ~2916.67 }
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
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2022-05-01", symbol: "ABC", type: "buy", quantity: 1000, unitPrice: 3.0 },
  { date: "2022-11-01", symbol: "ABC", type: "buy", quantity: 200, unitPrice: 4.8 },
  { date: "2022-11-01", symbol: "ABC", type: "sell", quantity: 500, unitPrice: 5.0 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const disposal = result.data.taxYears[0].disposals[0];
const sameDay = disposal.matches.find(m => m.rule === "same-day");
const pool = disposal.matches.find(m => m.rule === "section-104");

console.log(sameDay.quantity);        // 200
console.log(sameDay.costPerShareGBP); // 4.80
console.log(pool.quantity);           // 300
console.log(pool.costPerShareGBP);    // 3.00
console.log(disposal.gainGBP);        // 640
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
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2022-03-01", symbol: "DEF", type: "buy", quantity: 1000, unitPrice: 5.0 },
  { date: "2023-06-01", symbol: "DEF", type: "sell", quantity: 1000, unitPrice: 3.0 },
  { date: "2023-06-11", symbol: "DEF", type: "buy", quantity: 1000, unitPrice: 3.1 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const disposal = result.data.taxYears[0].disposals[0];
const bAndB = disposal.matches.find(m => m.rule === "bed-and-breakfast");

console.log(bAndB.quantity);        // 1000
console.log(bAndB.costPerShareGBP); // 3.10 (the rebuy price)
console.log(disposal.gainGBP);      // -100 (a loss)
```

## Example 4: Stock Splits

When a company does a stock split, the number of shares increases but the total cost basis stays the same. The library handles this automatically.

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
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt(
  [
    { date: "2022-01-01", symbol: "AMZN", type: "buy", quantity: 10, unitPrice: 3000 },
    { date: "2023-02-01", symbol: "AMZN", type: "sell", quantity: 100, unitPrice: 160 },
  ],
  {
    splitEvents: [
      { date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
    ],
  }
);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const disposal = result.data.taxYears[0].disposals[0];
console.log(disposal.matches[0].costPerShareGBP); // 150
console.log(disposal.gainGBP);                    // 1000
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
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2022-05-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: "2023-02-01", symbol: "AAPL", type: "sell", quantity: 100, unitPrice: 200, exchangeRate: 1.30 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const disposal = result.data.taxYears[0].disposals[0];
console.log(disposal.proceedsGBP);  // ~15384.62
console.log(disposal.totalCostGBP); // 12000
console.log(disposal.gainGBP);      // ~3384.62
```

## Example 6: Transfers (gifting to a spouse)

A transfer represents shares leaving your portfolio without a market sale — typically a gift to a spouse or civil partner. Under HMRC rules, transfers between spouses are treated as "no gain, no loss" disposals. The shares leave your Section 104 pool at their average cost.

**Scenario:** You hold 1,000 shares and transfer 400 to your spouse.

```typescript
import { calculateCgt } from "capital-gains-calculator";

const result = calculateCgt([
  { date: "2022-05-01", symbol: "VOD", type: "buy", quantity: 1000, unitPrice: 1.2 },
  { date: "2023-03-01", symbol: "VOD", type: "transfer", quantity: 400, unitPrice: 1.2 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const transfer = result.data.taxYears[0].disposals.find(d => d.type === "transfer");
console.log(transfer.gainGBP);                   // 0 (no gain, no loss)
console.log(transfer.poolImpact.sharesRemoved);  // 400
console.log(transfer.poolImpact.costRemoved);    // 480 (400 × £1.20)

// Your remaining pool
console.log(result.data.pools[0].shares); // 600
console.log(result.data.pools[0].costGBP); // 720
```

The `unitPrice` on a transfer should be the market value at the date of transfer (for record-keeping), but the gain is always zero because the cost is taken from the pool.

## Example 7: Annual Exempt Amount

Each tax year has a tax-free allowance (Annual Exempt Amount). Gains up to this amount are not taxable.

```typescript
import { calculateCgt, getDefaultAllowances } from "capital-gains-calculator";

const allowances = getDefaultAllowances();
console.log(allowances["2023/24"]); // 6000
console.log(allowances["2024/25"]); // 3000

const result = calculateCgt([
  { date: "2023-05-01", symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 50 },
  { date: "2024-01-01", symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 90 },
]);

if (!result.ok) { console.error(result.errors); process.exit(1); }

const year = result.data.taxYears[0];
console.log(year.taxYear);           // "2023/24"
console.log(year.totalGains);        // 4000
console.log(year.annualExemptAmount); // 6000
console.log(year.taxableGain);       // 0 (gain within AEA)
```

---

# Part 2: Developer Examples

## Integrating the Library

### Basic Integration

```typescript
import { calculateCgt } from "capital-gains-calculator";
import type { CgtTradeInput, CgtResult } from "capital-gains-calculator";

// Your trades from a database, CSV, or API
const trades: CgtTradeInput[] = [
  { date: "2022-05-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: "2023-01-15", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 180, exchangeRate: 1.22 },
];

const result = calculateCgt(trades);
if (!result.ok) {
  // result.errors contains all validation issues
  console.error(result.errors);
  process.exit(1);
}

// result.data is the CgtResult
const cgt: CgtResult = result.data;
```

### With Stock Splits

```typescript
import { calculateCgt } from "capital-gains-calculator";
import type { SplitEvent } from "capital-gains-calculator";

const splits: SplitEvent[] = [
  { date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
  { date: "2022-07-18", symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
];

const result = calculateCgt(trades, { splitEvents: splits });
if (!result.ok) { console.error(result.errors); process.exit(1); }
// Use result.data...
```

### With Custom Allowances

```typescript
import { calculateCgt } from "capital-gains-calculator";

// Override allowances (e.g. for testing or future tax years)
const allowances = {
  "2023/24": 6000,
  "2024/25": 3000,
  "2025/26": 3000,
};

const result = calculateCgt(trades, { allowances });
if (!result.ok) { console.error(result.errors); process.exit(1); }
// Use result.data...
```

## Validating and Normalising Trades

Use `normaliseTrades` to validate input data before calculation and get a clean, GBP-denominated view:

```typescript
import { normaliseTrades } from "capital-gains-calculator";

const result = normaliseTrades([
  { date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
  { date: "2007-01-01", symbol: "OLD", type: "buy", quantity: 10, unitPrice: 50 }, // invalid: before 2008
  { date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 200, unitPrice: 180 }, // invalid: overselling
]);

// Default: any validation error returns ok: false
if (!result.ok) {
  console.log(result.errors.length);  // 1 (first error found)
  console.log(result.errors[0].message); // "Trades before 6 April 2008..."
}
```

### Skip Invalid Mode

```typescript
import { normaliseTrades } from "capital-gains-calculator";

const result = normaliseTrades(
  [
    { date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 150, exchangeRate: 1.25 },
    { date: "2007-01-01", symbol: "OLD", type: "buy", quantity: 10, unitPrice: 50 },
    { date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 180, exchangeRate: 1.22 },
  ],
  { skipInvalid: true }
);

// With skipInvalid, result.ok is true — invalid trades skipped, errors reported alongside valid data
if (!result.ok) { console.error(result.errors); process.exit(1); }

const { transactions, errors } = result.data;
console.log(errors.length);        // 1 (the pre-2008 trade)
console.log(transactions.length);  // 2 (buy + sell)

// Transactions are in GBP, sorted, merged
console.log(transactions[0].valueGBP);  // 12000 (100 × 150 / 1.25)
console.log(transactions[0].feesGBP);   // 0
```

## Working with the Output

### Iterating Tax Year Summaries

```typescript
// Assuming result.ok === true, working with result.data:
for (const year of result.data.taxYears) {
  console.log(`--- ${year.taxYear} ---`);
  console.log(`Disposals: ${year.disposalCount}`);
  console.log(`Gains: £${year.totalGains.toFixed(2)}`);
  console.log(`Losses: £${year.totalLosses.toFixed(2)}`);
  console.log(`Net: £${year.netGainLoss.toFixed(2)}`);
  console.log(`AEA: £${year.annualExemptAmount}`);
  console.log(`Taxable: £${year.taxableGain.toFixed(2)}`);
}
```

### Inspecting Disposal Matching Details

```typescript
for (const disposal of year.disposals) {
  console.log(`${disposal.date} Sold ${disposal.quantity} ${disposal.symbol}`);
  console.log(`  Proceeds: £${disposal.proceedsGBP.toFixed(2)}`);
  console.log(`  Cost: £${disposal.totalCostGBP.toFixed(2)}`);
  console.log(`  Gain: £${disposal.gainGBP.toFixed(2)}`);

  for (const match of disposal.matches) {
    console.log(`  Matched by ${match.rule}: ${match.quantity} shares @ £${match.costPerShareGBP.toFixed(2)}`);
    if (match.matchedDate) {
      console.log(`    Against acquisition on ${match.matchedDate}`);
    }
  }

  // Pool impact shows what changed
  if (disposal.poolImpact) {
    console.log(`  Pool: -${disposal.poolImpact.sharesRemoved} shares, -£${disposal.poolImpact.costRemoved?.toFixed(2)}`);
  } else {
    console.log(`  Pool: unchanged (fully matched by same-day/B&B)`);
  }
}
```

### Tracking Acquisitions

```typescript
for (const acquisition of year.acquisitions) {
  console.log(`${acquisition.date} Bought ${acquisition.quantity} ${acquisition.symbol}`);
  console.log(`  Cost: £${acquisition.costGBP.toFixed(2)}`);

  for (const disp of acquisition.dispositions) {
    console.log(`  ${disp.rule}: ${disp.quantity} shares ${disp.matchedDate ? `matched to sale on ${disp.matchedDate}` : "added to pool"}`);
  }

  if (acquisition.poolImpact) {
    console.log(`  Pool: +${acquisition.poolImpact.sharesAdded} shares, +£${acquisition.poolImpact.costAdded?.toFixed(2)}`);
  } else {
    console.log(`  Pool: unchanged (fully consumed by same-day/B&B)`);
  }
}
```

### Reading Pool State

```typescript
// Current pool state (end of all trades)
for (const pool of result.data.pools) {
  console.log(`${pool.symbol}: ${pool.shares} shares, cost £${pool.costGBP.toFixed(2)}, avg £${(pool.costGBP / pool.shares).toFixed(2)}/share`);
}

// Pool state at end of each tax year
for (const [taxYear, pools] of Object.entries(result.data.poolSnapshots)) {
  console.log(`\n${taxYear}:`);
  for (const pool of pools) {
    console.log(`  ${pool.symbol}: ${pool.shares} shares, £${pool.costGBP.toFixed(2)}`);
  }
}
```

## AEA Optimisation

Calculate how many shares to sell to use up remaining tax-free allowance:

```typescript
import { calculateCgt, calculateOptimalSell } from "capital-gains-calculator";

// First, calculate current position
const cgtResult = calculateCgt(trades, { splitEvents });
if (!cgtResult.ok) { console.error(cgtResult.errors); process.exit(1); }

const pool = cgtResult.data.pools.find(p => p.symbol === "AAPL");
const year = cgtResult.data.taxYears.find(y => y.taxYear === "2024/25");

// How much AEA is left?
const remainingAEA = Math.max(0, year.annualExemptAmount - year.netGainLoss);

// Optimise — whole shares, default 5% tolerance
const optimal = calculateOptimalSell({
  symbol: "AAPL",
  currentPrice: 195,            // current market price in trade currency
  exchangeRate: 1.27,           // current GBP rate
  poolCostPerShare: pool.costGBP / pool.shares,
  poolShares: pool.shares,
  remainingAEA,
});

// Handle the result
if (!optimal.ok) {
  console.log("Invalid inputs:", optimal.errors);
} else {
  switch (optimal.data.status) {
    case "success":
      console.log(`Sell ${optimal.data.quantity} shares — uses £${optimal.data.aeaUsed.toFixed(2)} of AEA`);
      break;
    case "partial":
      console.log(`Best possible: sell ${optimal.data.quantity} shares (${optimal.data.reason})`);
      break;
    case "loss":
      console.log(`Cannot optimise — stock is at a loss (£${optimal.data.lossPerShare?.toFixed(2)}/share)`);
      break;
    case "impossible":
      console.log(`Cannot sell any shares profitably: ${optimal.data.reason}`);
      break;
  }
}
```

### Fractional shares

If your broker supports fractional shares, enable them to get closer to the AEA target:

```typescript
const optimal = calculateOptimalSell({
  symbol: "AAPL",
  currentPrice: 195,
  exchangeRate: 1.27,
  poolCostPerShare: pool.costGBP / pool.shares,
  poolShares: pool.shares,
  remainingAEA: 100,
  allowFractional: true,  // allows e.g. 2.5 shares
  tolerance: 0.02,        // within 2% of AEA target
});

if (optimal.ok && optimal.data.status === "success") {
  console.log(`Sell ${optimal.data.quantity.toFixed(4)} shares — AEA fully used`);
}
```

### Custom tolerance

Control how close to "full" AEA usage you require:

```typescript
// Strict — must use at least 99% of remaining AEA
const strict = calculateOptimalSell({ ...params, tolerance: 0.01 });

// Lenient — anything above 80% is good enough
const lenient = calculateOptimalSell({ ...params, tolerance: 0.20 });
```

## Tax Rates

Look up the applicable CGT rates for a disposal date:

```typescript
import { getRatesForDate, getTaxYearConfig } from "capital-gains-calculator";

// Simple lookup
const rates = getRatesForDate("2024-06-15");
console.log(rates); // { basic: 10, higher: 20 }

// After October 2024 Budget
const newRates = getRatesForDate("2024-11-01");
console.log(newRates); // { basic: 18, higher: 24 }

// Full tax year config
const config = getTaxYearConfig("2024/25");
console.log(config.annualExemptAmount);  // 3000
console.log(config.reportingThreshold);  // 50000
console.log(config.ratePeriods);         // Two periods (before/after 30 Oct 2024)
```

## Building a Timeline View

Combine disposals, acquisitions, and split events into a chronological timeline:

```typescript
import { calculateCgt } from "capital-gains-calculator";
import type { SplitEvent } from "capital-gains-calculator";

const splits: SplitEvent[] = [
  { date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
];

const result = calculateCgt(trades, { splitEvents: splits });
if (!result.ok) { console.error(result.errors); process.exit(1); }

// Build timeline from all event types
type TimelineEvent =
  | { type: "acquisition"; date: string; data: typeof result.data.taxYears[0]["acquisitions"][0] }
  | { type: "disposal"; date: string; data: typeof result.data.taxYears[0]["disposals"][0] }
  | { type: "split"; date: string; data: SplitEvent };

const timeline: TimelineEvent[] = [];

for (const year of result.data.taxYears) {
  for (const a of year.acquisitions) timeline.push({ type: "acquisition", date: a.date, data: a });
  for (const d of year.disposals) timeline.push({ type: "disposal", date: d.date, data: d });
}
for (const s of splits) timeline.push({ type: "split", date: s.date, data: s });

timeline.sort((a, b) => a.date.localeCompare(b.date));

for (const event of timeline) {
  switch (event.type) {
    case "acquisition":
      console.log(`${event.date} BUY ${event.data.quantity} ${event.data.symbol} | Pool after: ${event.data.poolStateAfter.find(p => p.symbol === event.data.symbol)?.shares ?? 0} shares`);
      break;
    case "disposal":
      console.log(`${event.date} SELL ${event.data.quantity} ${event.data.symbol} | Gain: £${event.data.gainGBP.toFixed(2)}`);
      break;
    case "split":
      console.log(`${event.date} SPLIT ${event.data.symbol} ${event.data.ratioFrom}:${event.data.ratioTo}`);
      break;
  }
}
```
