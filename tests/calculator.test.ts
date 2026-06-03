import { describe, it, expect } from "vitest";
import { calculateCgt } from "../src/calculate";
import { CgValidationError } from "../src/errors";
import { deriveMatchCostGBP, deriveEventGainGBP, type EventDeriveContext } from "../src/utils";
import type {
  CgCalculateOptions,
  CgTradeInput,
  CgSplitEvent,
  CgCalculateResult,
  CgEvent,
  CgMatch,
} from "../src/types";

function d(s: string): Date {
  return new Date(s);
}

function makeTrade(
  overrides: Partial<CgTradeInput> & {
    date: Date;
    symbol: string;
    type: "buy" | "sell" | "transfer";
    quantity: number;
    unitPrice: number;
  }
): CgTradeInput {
  return {
    allowableExpenditure: 0,
    exchangeRate: 1.0,
    ...overrides,
  };
}

function runCgt(inputs: CgTradeInput[], options?: CgCalculateOptions): CgCalculateResult {
  return calculateCgt(inputs, options);
}

function findSellEvent(
  result: CgCalculateResult,
  date: string,
  symbol: string
): CgEvent | undefined {
  const target = new Date(date).getTime();
  for (const ty of result.taxYears) {
    for (const p of ty.periods) {
      const found = p.events.find(
        (e) =>
          (e.type === "sell" || e.type === "transfer") &&
          e.date.getTime() === target &&
          e.symbol === symbol
      );
      if (found) return found;
    }
  }
  return undefined;
}

function findTaxYear(result: CgCalculateResult, taxYear: string) {
  return result.taxYears.find((ty) => ty.taxYear === taxYear);
}

function currentPools(result: CgCalculateResult) {
  return result.taxYears.length > 0 ? result.taxYears[0].poolAtYearEnd : [];
}

describe("CGT Calculator - Section 104 Pool", () => {
  it("builds a pool from multiple buys and matches sell against weighted average cost", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-06-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 120,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 130,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AAPL")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("section-104");
    expect(event.matches[0].originalMatchedQuantity).toBe(40);
    // Pool average: (50*100 + 50*120) / 100 = 110 per share
    const costPerShare = event.matches[0].costGBP / 40;
    expect(costPerShare).toBeCloseTo(110, 2);
    // Gain: 40 * 130 - 40 * 110 = 800
    expect(event.gainGBP).toBeCloseTo(800, 0);
  });

  it("disposes entire pool leaving zero shares", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades);
    const pool = currentPools(result).find((p) => p.symbol === "AAPL");
    expect(pool).toBeUndefined();
  });

  it("handles multiple symbols independently", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-05-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 30,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 25,
        unitPrice: 110,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "MSFT",
        type: "sell",
        quantity: 30,
        unitPrice: 220,
      }),
    ];
    const result = runCgt(trades);
    const aaplEvent = findSellEvent(result, "2022-09-01", "AAPL")!;
    const msftEvent = findSellEvent(result, "2022-09-01", "MSFT")!;

    expect(aaplEvent.gainGBP).toBeCloseTo(25 * 10, 0);
    expect(msftEvent.gainGBP).toBeCloseTo(30 * 20, 0);
  });
});

describe("CGT Calculator - Same-Day Matching", () => {
  it("matches same-day buy and sell before pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 130,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 20,
        unitPrice: 135,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AAPL")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("same-day");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(20);
    const costPerShare = event.matches[0].costGBP / 20;
    expect(costPerShare).toBeCloseTo(130, 2);
  });

  it("partial same-day match: remainder goes to pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 80,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 130,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 135,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AAPL")!;

    expect(event.matches).toHaveLength(2);
    const sameDayMatch = event.matches.find((m) => m.rule === "same-day")!;
    const poolMatch = event.matches.find((m) => m.rule === "section-104")!;

    expect(sameDayMatch.originalMatchedQuantity * event.splitFactor).toBe(20);
    expect(poolMatch.originalMatchedQuantity * event.splitFactor).toBe(30);
    const poolCostPerShare = poolMatch.costGBP / 30;
    expect(poolCostPerShare).toBeCloseTo(100, 2);
  });

  it("multiple same-day buys compose into single match", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 40,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 15,
        unitPrice: 230,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 10,
        unitPrice: 232,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "MSFT",
        type: "sell",
        quantity: 40,
        unitPrice: 235,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "MSFT")!;

    const sameDayMatch = event.matches.find((m) => m.rule === "same-day")!;
    expect(sameDayMatch.originalMatchedQuantity * event.splitFactor).toBe(25);
    // Weighted average: (15*230 + 10*232) / 25 = 230.8
    const costPerShare = sameDayMatch.costGBP / 25;
    expect(costPerShare).toBeCloseTo(230.8, 1);
  });

  it("exact quantity same-day match (no remainder)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AVGO",
        type: "buy",
        quantity: 5,
        unitPrice: 1600,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AVGO",
        type: "sell",
        quantity: 5,
        unitPrice: 1620,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AVGO")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("same-day");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(5);
    expect(event.gainGBP).toBeCloseTo(5 * 20, 0);
  });

  it("multiple sells same day are merged into single disposal", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "GOOGL",
        type: "sell",
        quantity: 80,
        unitPrice: 110,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "GOOGL",
        type: "sell",
        quantity: 50,
        unitPrice: 111,
      }),
    ];
    const result = runCgt(trades);
    const taxYear = findTaxYear(result, "2022/23")!;
    const googlSells = taxYear.periods[0].events.filter(
      (e) =>
        e.type === "sell" && e.symbol === "GOOGL" && e.date.getTime() === d("2022-09-01").getTime()
    );

    expect(googlSells).toHaveLength(1);
    expect(googlSells[0].quantity).toBe(130);
  });
});

describe("CGT Calculator - Bed and Breakfast (30-day rule)", () => {
  it("matches sell with rebuy within 30 days", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 178,
      }),
      makeTrade({
        date: d("2022-11-20"),
        symbol: "NVDA",
        type: "sell",
        quantity: 40,
        unitPrice: 155,
      }),
      makeTrade({
        date: d("2022-11-30"),
        symbol: "NVDA",
        type: "buy",
        quantity: 40,
        unitPrice: 148,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-11-20", "NVDA")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("bed-and-breakfast");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(40);
    const costPerShare = event.matches[0].costGBP / 40;
    expect(costPerShare).toBeCloseTo(148, 2);
  });

  it("partial B&B: sell more than rebought, remainder from pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "META",
        type: "buy",
        quantity: 60,
        unitPrice: 168,
      }),
      makeTrade({
        date: d("2022-12-05"),
        symbol: "META",
        type: "sell",
        quantity: 60,
        unitPrice: 120,
      }),
      makeTrade({
        date: d("2022-12-20"),
        symbol: "META",
        type: "buy",
        quantity: 25,
        unitPrice: 118,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-12-05", "META")!;

    expect(event.matches).toHaveLength(2);
    const bAndB = event.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = event.matches.find((m) => m.rule === "section-104")!;

    expect(bAndB.originalMatchedQuantity * event.splitFactor).toBe(25);
    expect(pool.originalMatchedQuantity * event.splitFactor).toBe(35);
    const poolCostPerShare = pool.costGBP / 35;
    expect(poolCostPerShare).toBeCloseTo(168, 2);
  });

  it("multiple B&B rebuys matched in chronological order", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 170,
      }),
      makeTrade({
        date: d("2023-10-10"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 178,
      }),
      makeTrade({
        date: d("2023-10-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 175,
      }),
      makeTrade({
        date: d("2023-10-25"),
        symbol: "AAPL",
        type: "buy",
        quantity: 12,
        unitPrice: 171,
      }),
      makeTrade({
        date: d("2023-11-05"),
        symbol: "AAPL",
        type: "buy",
        quantity: 8,
        unitPrice: 176,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2023-10-10", "AAPL")!;

    const bAndBMatches = event.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatches).toHaveLength(3);
    expect(bAndBMatches[0].originalMatchedQuantity * event.splitFactor).toBe(10);
    expect(bAndBMatches[1].originalMatchedQuantity * event.splitFactor).toBe(12);
    expect(bAndBMatches[2].originalMatchedQuantity * event.splitFactor).toBe(8);

    const poolMatch = event.matches.find((m) => m.rule === "section-104");
    expect(poolMatch!.originalMatchedQuantity * event.splitFactor).toBe(10);
  });

  it("matches the EARLIER rebuy first when rebuys exceed the sell (FIFO, TCGA92 s.106A(5)(b))", () => {
    // The sell (10) is smaller than either rebuy (10 each), so only ONE rebuy is
    // consumed by B&B. FIFO must pick the EARLIER, cheaper rebuy (@130), not the
    // later one (@160) — this is the case that distinguishes FIFO from LIFO, since
    // the two produce different cost bases and therefore different gains.
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 200,
      }),
      // Earlier rebuy, cheaper — FIFO should match against this one.
      makeTrade({
        date: d("2023-06-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 130,
      }),
      // Later rebuy, dearer — still inside the 30-day window but must NOT be matched first.
      makeTrade({
        date: d("2023-06-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 160,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = findSellEvent(result, "2023-06-01", "AAPL")!;

    // Exactly one B&B match, for the full 10 shares.
    const bAndBMatches = sellEvent.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatches).toHaveLength(1);
    expect(bAndBMatches[0].originalMatchedQuantity * sellEvent.splitFactor).toBe(10);

    // It must cite the EARLIER rebuy (2023-06-10 @ 130), not the later one (@160).
    expect(bAndBMatches[0].matchedDate).toEqual(d("2023-06-10"));
    const costPerShare = bAndBMatches[0].costGBP / 10;
    expect(costPerShare).toBeCloseTo(130, 2);

    // Gain proves FIFO: 10*200 - 10*130 = 700 (LIFO @160 would have given 400).
    expect(sellEvent.gainGBP).toBeCloseTo(700, 2);

    // The later rebuy is untouched by B&B and falls into the Section 104 pool instead.
    const laterBuy = result.taxYears[0].periods[0].events.find(
      (e) => e.type === "buy" && e.date.getTime() === d("2023-06-20").getTime()
    )!;
    expect(laterBuy.matches.every((m) => m.rule === "section-104")).toBe(true);
  });

  it("handles two B&B rebuys on the same date (tiebreaker by id)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "TEST",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "TEST",
        type: "sell",
        quantity: 40,
        unitPrice: 70,
      }),
      makeTrade({
        date: d("2022-09-10"),
        symbol: "TEST",
        type: "buy",
        quantity: 15,
        unitPrice: 65,
      }),
      makeTrade({
        date: d("2022-09-10"),
        symbol: "TEST",
        type: "buy",
        quantity: 10,
        unitPrice: 66,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "TEST")!;

    const bAndBMatches = event.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatches.length).toBeGreaterThanOrEqual(1);
    const totalBnB = bAndBMatches.reduce(
      (s, m) => s + m.originalMatchedQuantity * event.splitFactor,
      0
    );
    expect(totalBnB).toBe(25);
  });

  it("rebuy at exactly day 30 triggers B&B", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "LLY",
        type: "buy",
        quantity: 8,
        unitPrice: 760,
      }),
      makeTrade({
        date: d("2024-08-01"),
        symbol: "LLY",
        type: "sell",
        quantity: 8,
        unitPrice: 930,
      }),
      makeTrade({
        date: d("2024-08-31"),
        symbol: "LLY",
        type: "buy",
        quantity: 8,
        unitPrice: 915,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-08-01", "LLY")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("bed-and-breakfast");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(8);
  });

  it("rebuy at day 31 does NOT trigger B&B", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "CRM",
        type: "buy",
        quantity: 25,
        unitPrice: 234,
      }),
      makeTrade({
        date: d("2024-09-10"),
        symbol: "CRM",
        type: "sell",
        quantity: 25,
        unitPrice: 260,
      }),
      makeTrade({
        date: d("2024-10-11"),
        symbol: "CRM",
        type: "buy",
        quantity: 25,
        unitPrice: 255,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-09-10", "CRM")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("section-104");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(25);
  });

  it("B&B spanning tax year boundary", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "UNH",
        type: "buy",
        quantity: 10,
        unitPrice: 480,
      }),
      makeTrade({
        date: d("2024-03-25"),
        symbol: "UNH",
        type: "sell",
        quantity: 10,
        unitPrice: 495,
      }),
      makeTrade({
        date: d("2024-04-10"),
        symbol: "UNH",
        type: "buy",
        quantity: 10,
        unitPrice: 488,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-03-25", "UNH")!;

    expect(event.matches).toHaveLength(1);
    expect(event.matches[0].rule).toBe("bed-and-breakfast");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(10);
    const costPerShare = event.matches[0].costGBP / 10;
    expect(costPerShare).toBeCloseTo(488, 2);
  });
});

describe("CGT Calculator - Combined Rules (same-day + B&B + pool)", () => {
  it("all three rules triggered on single sell", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AMZN",
        type: "buy",
        quantity: 50,
        unitPrice: 186,
      }),
      makeTrade({
        date: d("2024-07-15"),
        symbol: "AMZN",
        type: "buy",
        quantity: 5,
        unitPrice: 195,
      }),
      makeTrade({
        date: d("2024-07-15"),
        symbol: "AMZN",
        type: "sell",
        quantity: 30,
        unitPrice: 197,
      }),
      makeTrade({
        date: d("2024-07-25"),
        symbol: "AMZN",
        type: "buy",
        quantity: 10,
        unitPrice: 190,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-07-15", "AMZN")!;

    const sameDay = event.matches.find((m) => m.rule === "same-day")!;
    const bAndB = event.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = event.matches.find((m) => m.rule === "section-104")!;

    expect(sameDay.originalMatchedQuantity * event.splitFactor).toBe(5);
    expect(bAndB.originalMatchedQuantity * event.splitFactor).toBe(10);
    expect(pool.originalMatchedQuantity * event.splitFactor).toBe(15);
  });

  it("same-day match priority over B&B and pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-01-01"),
        symbol: "TEST",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2024-06-01"),
        symbol: "TEST",
        type: "buy",
        quantity: 20,
        unitPrice: 70,
      }),
      makeTrade({
        date: d("2024-06-01"),
        symbol: "TEST",
        type: "sell",
        quantity: 80,
        unitPrice: 75,
      }),
      makeTrade({
        date: d("2024-06-10"),
        symbol: "TEST",
        type: "buy",
        quantity: 30,
        unitPrice: 72,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-06-01", "TEST")!;

    const rules = event.matches.map((m) => m.rule);
    expect(rules).toContain("same-day");
    expect(rules).toContain("bed-and-breakfast");
    expect(rules).toContain("section-104");

    const sameDay = event.matches.find((m) => m.rule === "same-day")!;
    const bAndB = event.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = event.matches.find((m) => m.rule === "section-104")!;

    expect(sameDay.originalMatchedQuantity * event.splitFactor).toBe(20);
    expect(bAndB.originalMatchedQuantity * event.splitFactor).toBe(30);
    expect(pool.originalMatchedQuantity * event.splitFactor).toBe(30);
  });
});

// =============================================================================
// Match-composition matrix
//
// A self-contained enumeration of every rule combination a single event's
// `matches` array can take — disposals (sell-side, S1–S11) and the mirror
// combinations recorded on an acquisition (buy-side, B12–B22). Read these two
// blocks as a checklist: every reachable composition of same-day / B&B /
// section-104 appears exactly once, so coverage of the matching surface is
// auditable at a glance.
//
// Conventions (see the comment on `composition` below):
//   - Same-day/symbol/type trades are MERGED before matching, so an event can
//     never carry more than one same-day match — "multiple same-day" is not a
//     reachable case and is intentionally absent.
//   - Matches are addressed BY RULE (never by array index): same-day and pool
//     are unique per event, B&B may appear multiple times and is summed. This
//     stays correct even if a future refactor reorders the matches array.
//   - Quantities are whole and shown split-adjusted (× splitFactor, here always
//     1), so assertions are exact.
// =============================================================================

/** Split-adjusted matched quantity for a single rule on an event (sums B&B). */
function matchedQty(event: CgEvent, rule: CgMatch["rule"]): number {
  return event.matches
    .filter((m) => m.rule === rule)
    .reduce((sum, m) => sum + m.originalMatchedQuantity * event.splitFactor, 0);
}

/** Number of distinct match entries for a rule (B&B can be > 1). */
function matchCount(event: CgEvent, rule: CgMatch["rule"]): number {
  return event.matches.filter((m) => m.rule === rule).length;
}

/** The set of rules present on an event, for asserting "no pool" etc. */
function rulesPresent(event: CgEvent): CgMatch["rule"][] {
  return event.matches.map((m) => m.rule);
}

describe("CGT Calculator - Disposal match composition (sell-side matrix S1–S11)", () => {
  it("S1: same-day only", () => {
    const result = runCgt([
      makeTrade({ date: d("2023-06-01"), symbol: "S1", type: "buy", quantity: 40, unitPrice: 100 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S1",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S1")!;
    expect(rulesPresent(sell)).toEqual(["same-day"]);
    expect(matchedQty(sell, "same-day")).toBe(40);
  });

  it("S2: B&B only", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S2",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S2",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S2", type: "buy", quantity: 40, unitPrice: 140 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S2")!;
    expect(rulesPresent(sell)).toEqual(["bed-and-breakfast"]);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(40);
  });

  it("S3: multiple B&B only (no pool)", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S3",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S3",
        type: "sell",
        quantity: 20,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S3", type: "buy", quantity: 8, unitPrice: 140 }),
      makeTrade({ date: d("2023-06-20"), symbol: "S3", type: "buy", quantity: 12, unitPrice: 145 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S3")!;
    expect(matchCount(sell, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(20);
    expect(matchCount(sell, "section-104")).toBe(0);
  });

  it("S4: same-day + B&B (no pool)", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S4",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({ date: d("2023-06-01"), symbol: "S4", type: "buy", quantity: 10, unitPrice: 130 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S4",
        type: "sell",
        quantity: 25,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S4", type: "buy", quantity: 15, unitPrice: 140 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S4")!;
    expect(matchedQty(sell, "same-day")).toBe(10);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(15);
    expect(matchCount(sell, "section-104")).toBe(0);
  });

  it("S5: same-day + multiple B&B (no pool)", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S5",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({ date: d("2023-06-01"), symbol: "S5", type: "buy", quantity: 10, unitPrice: 130 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S5",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S5", type: "buy", quantity: 12, unitPrice: 140 }),
      makeTrade({ date: d("2023-06-20"), symbol: "S5", type: "buy", quantity: 8, unitPrice: 141 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S5")!;
    expect(matchedQty(sell, "same-day")).toBe(10);
    expect(matchCount(sell, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(20);
    expect(matchCount(sell, "section-104")).toBe(0);
  });

  it("S6: section-104 only", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S6",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S6",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S6")!;
    expect(rulesPresent(sell)).toEqual(["section-104"]);
    expect(matchedQty(sell, "section-104")).toBe(40);
  });

  it("S7: same-day + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S7",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({ date: d("2023-06-01"), symbol: "S7", type: "buy", quantity: 20, unitPrice: 130 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S7",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S7")!;
    expect(matchedQty(sell, "same-day")).toBe(20);
    expect(matchedQty(sell, "section-104")).toBe(30);
    expect(matchCount(sell, "bed-and-breakfast")).toBe(0);
  });

  it("S8: same-day + B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S8",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({ date: d("2023-06-01"), symbol: "S8", type: "buy", quantity: 10, unitPrice: 130 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S8",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S8", type: "buy", quantity: 15, unitPrice: 140 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S8")!;
    expect(matchedQty(sell, "same-day")).toBe(10);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(15);
    expect(matchedQty(sell, "section-104")).toBe(15);
  });

  it("S9: same-day + multiple B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S9",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({ date: d("2023-06-01"), symbol: "S9", type: "buy", quantity: 10, unitPrice: 130 }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S9",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
      makeTrade({ date: d("2023-06-10"), symbol: "S9", type: "buy", quantity: 12, unitPrice: 140 }),
      makeTrade({ date: d("2023-06-20"), symbol: "S9", type: "buy", quantity: 8, unitPrice: 141 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S9")!;
    expect(matchedQty(sell, "same-day")).toBe(10);
    expect(matchCount(sell, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(20);
    expect(matchedQty(sell, "section-104")).toBe(20);
  });

  it("S10: B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S10",
        type: "buy",
        quantity: 60,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S10",
        type: "sell",
        quantity: 60,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-10"),
        symbol: "S10",
        type: "buy",
        quantity: 25,
        unitPrice: 140,
      }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S10")!;
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(25);
    expect(matchedQty(sell, "section-104")).toBe(35);
    expect(matchCount(sell, "same-day")).toBe(0);
  });

  it("S11: multiple B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "S11",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "S11",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-10"),
        symbol: "S11",
        type: "buy",
        quantity: 10,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "S11",
        type: "buy",
        quantity: 12,
        unitPrice: 141,
      }),
      makeTrade({ date: d("2023-06-28"), symbol: "S11", type: "buy", quantity: 8, unitPrice: 142 }),
    ]);
    const sell = findSellEvent(result, "2023-06-01", "S11")!;
    expect(matchCount(sell, "bed-and-breakfast")).toBe(3);
    expect(matchedQty(sell, "bed-and-breakfast")).toBe(30);
    expect(matchedQty(sell, "section-104")).toBe(10);
    expect(matchCount(sell, "same-day")).toBe(0);
  });
});

describe("CGT Calculator - Acquisition match composition (buy-side matrix B12–B22)", () => {
  /** Locate a buy event by symbol and date. */
  function buyEvent(result: CgCalculateResult, date: string, symbol: string): CgEvent {
    const target = new Date(date).getTime();
    for (const ty of result.taxYears) {
      for (const p of ty.periods) {
        const found = p.events.find(
          (e) => e.type === "buy" && e.date.getTime() === target && e.symbol === symbol
        );
        if (found) return found;
      }
    }
    throw new Error(`buy event not found: ${symbol} @ ${date}`);
  }

  it("B12: same-day", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B12",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B12",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-01", "B12");
    expect(rulesPresent(buy)).toEqual(["same-day"]);
    expect(matchedQty(buy, "same-day")).toBe(50);
  });

  it("B13: B&B", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B13",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B13",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-15"),
        symbol: "B13",
        type: "buy",
        quantity: 30,
        unitPrice: 140,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-15", "B13");
    expect(rulesPresent(buy)).toEqual(["bed-and-breakfast"]);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(30);
  });

  it("B14: multiple B&B", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B14",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B14",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "B14",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B14",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B14");
    expect(matchCount(buy, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(20);
    expect(matchCount(buy, "section-104")).toBe(0);
  });

  it("B15: same-day + B&B (no pool)", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B15",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "B15",
        type: "sell",
        quantity: 15,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B15",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B15",
        type: "sell",
        quantity: 5,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B15");
    expect(matchedQty(buy, "same-day")).toBe(5);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(15);
    expect(matchCount(buy, "section-104")).toBe(0);
  });

  it("B16: same-day + multiple B&B (no pool)", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B16",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-03"),
        symbol: "B16",
        type: "sell",
        quantity: 6,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-08"),
        symbol: "B16",
        type: "sell",
        quantity: 9,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B16",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B16",
        type: "sell",
        quantity: 5,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B16");
    expect(matchedQty(buy, "same-day")).toBe(5);
    expect(matchCount(buy, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(15);
    expect(matchCount(buy, "section-104")).toBe(0);
  });

  it("B17: section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B17",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-01", "B17");
    expect(rulesPresent(buy)).toEqual(["section-104"]);
    expect(matchedQty(buy, "section-104")).toBe(100);
  });

  it("B18: same-day + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B18",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "B18",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-01", "B18");
    expect(matchedQty(buy, "same-day")).toBe(30);
    expect(matchedQty(buy, "section-104")).toBe(20);
    expect(matchCount(buy, "bed-and-breakfast")).toBe(0);
  });

  it("B19: B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B19",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "B19",
        type: "sell",
        quantity: 15,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B19",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B19");
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(15);
    expect(matchedQty(buy, "section-104")).toBe(5);
    expect(matchCount(buy, "same-day")).toBe(0);
  });

  it("B20: multiple B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B20",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "B20",
        type: "sell",
        quantity: 8,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-08"),
        symbol: "B20",
        type: "sell",
        quantity: 7,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B20",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B20");
    expect(matchCount(buy, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(15);
    expect(matchedQty(buy, "section-104")).toBe(5);
    expect(matchCount(buy, "same-day")).toBe(0);
  });

  it("B21: same-day + B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B21",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "B21",
        type: "sell",
        quantity: 8,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B21",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B21",
        type: "sell",
        quantity: 5,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B21");
    expect(matchedQty(buy, "same-day")).toBe(5);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(8);
    expect(matchedQty(buy, "section-104")).toBe(7);
  });

  it("B22: same-day + multiple B&B + section-104", () => {
    const result = runCgt([
      makeTrade({
        date: d("2023-01-01"),
        symbol: "B22",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-03"),
        symbol: "B22",
        type: "sell",
        quantity: 6,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-08"),
        symbol: "B22",
        type: "sell",
        quantity: 4,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B22",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-06-20"),
        symbol: "B22",
        type: "sell",
        quantity: 5,
        unitPrice: 150,
      }),
    ]);
    const buy = buyEvent(result, "2023-06-20", "B22");
    expect(matchedQty(buy, "same-day")).toBe(5);
    expect(matchCount(buy, "bed-and-breakfast")).toBe(2);
    expect(matchedQty(buy, "bed-and-breakfast")).toBe(10);
    expect(matchedQty(buy, "section-104")).toBe(5);
  });
});

describe("CGT Calculator - Transfers", () => {
  it("transfer removes shares from pool at cost (zero gain)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AMZN",
        type: "buy",
        quantity: 80,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AMZN",
        type: "transfer",
        quantity: 40,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AMZN")!;

    expect(event.type).toBe("transfer");
    expect(event.gainGBP).toBe(0);
    const pool = currentPools(result).find((p) => p.symbol === "AMZN")!;
    expect(pool.shares).toBe(40);
    expect(pool.costGBP).toBeCloseTo(40 * 100, 0);
  });
});

describe("CGT Calculator - Transfer matching (same-day & B&B)", () => {
  it("transfer matches same-day buy (not pool), affecting cost basis for recipient", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-01-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2023-01-15"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 50,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("same-day");
    const costPerShare = transfer.matches[0].costGBP / 50;
    expect(costPerShare).toBeCloseTo(200, 0);
    expect(transfer.costGBP).toBeCloseTo(50 * 200, 0);

    // Pool should retain original 100 shares at £50 (the same-day buy was consumed by transfer)
    const pool = currentPools(result).find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(100);
    expect(pool.costGBP).toBeCloseTo(100 * 50, 0);
  });

  it("transfer matches B&B buy within 30 days", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-01-10"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 0,
      }),
      makeTrade({
        date: d("2023-01-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 180,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("bed-and-breakfast");
    const costPerShare = transfer.matches[0].costGBP / 30;
    expect(costPerShare).toBeCloseTo(180, 0);
    expect(transfer.costGBP).toBeCloseTo(30 * 180, 0);

    // Pool should retain original 100 shares at £50 (the B&B buy was consumed by transfer)
    const pool = currentPools(result).find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(100);
    expect(pool.costGBP).toBeCloseTo(100 * 50, 0);
  });

  it("transfer with partial same-day match and remainder from pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-01-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2023-01-15"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 50,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(2);

    const sameDayMatch = transfer.matches.find((m) => m.rule === "same-day")!;
    expect(sameDayMatch.originalMatchedQuantity * transfer.splitFactor).toBe(20);
    const sameDayCostPerShare = sameDayMatch.costGBP / 20;
    expect(sameDayCostPerShare).toBeCloseTo(200, 0);

    const poolMatch = transfer.matches.find((m) => m.rule === "section-104")!;
    expect(poolMatch.originalMatchedQuantity * transfer.splitFactor).toBe(30);
    const poolCostPerShare = poolMatch.costGBP / 30;
    expect(poolCostPerShare).toBeCloseTo(50, 0);

    // Cost basis for recipient: 20 shares at £200 + 30 shares at £50
    expect(transfer.costGBP).toBeCloseTo(20 * 200 + 30 * 50, 0);

    // Pool: started with 100 @ £50, 30 removed from pool
    const pool = currentPools(result).find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(70);
    expect(pool.costGBP).toBeCloseTo(70 * 50, 0);
  });

  it("transfer B&B does not consume buy needed for a sell on same day", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-01-10"),
        symbol: "AAPL",
        type: "sell",
        quantity: 30,
        unitPrice: 180,
      }),
      makeTrade({
        date: d("2023-01-10"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 0,
      }),
      makeTrade({
        date: d("2023-01-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 160,
      }),
    ];
    const result = runCgt(trades);

    const sell = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;

    // Both sell and transfer should try to match the B&B buy (40 shares available)
    const sellBnB = sell.matches.find((m) => m.rule === "bed-and-breakfast");
    const transferBnB = transfer.matches.find((m) => m.rule === "bed-and-breakfast");

    // The 40 available B&B shares should be distributed across both disposals
    const totalBnBMatched =
      (sellBnB ? sellBnB.originalMatchedQuantity * sell.splitFactor : 0) +
      (transferBnB ? transferBnB.originalMatchedQuantity * transfer.splitFactor : 0);
    expect(totalBnBMatched).toBe(40);

    expect(sell.gainGBP).not.toBe(0);
    expect(transfer.gainGBP).toBe(0);
  });

  it("transfer still falls through to pool when no same-day or B&B available", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 40,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("section-104");
    const costPerShare = transfer.matches[0].costGBP / 40;
    expect(costPerShare).toBeCloseTo(50, 0);
    expect(transfer.costGBP).toBeCloseTo(40 * 50, 0);

    const pool = currentPools(result).find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(60);
    expect(pool.costGBP).toBeCloseTo(60 * 50, 0);
  });
});

describe("CGT Calculator - Losses", () => {
  it("loss when selling below cost", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "TSLA",
        type: "buy",
        quantity: 30,
        unitPrice: 303,
      }),
      makeTrade({
        date: d("2023-01-15"),
        symbol: "TSLA",
        type: "sell",
        quantity: 30,
        unitPrice: 122,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2023-01-15", "TSLA")!;

    expect(event.gainGBP).toBeLessThan(0);
    expect(event.gainGBP).toBeCloseTo(30 * (122 - 303), 0);
  });

  it("fees cause a loss even when price is unchanged", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2025-01-10"),
        symbol: "HD",
        type: "buy",
        quantity: 10,
        unitPrice: 380,
        allowableExpenditure: 5,
      }),
      makeTrade({
        date: d("2025-01-10"),
        symbol: "HD",
        type: "sell",
        quantity: 10,
        unitPrice: 380,
        allowableExpenditure: 5,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2025-01-10", "HD")!;

    expect(event.gainGBP).toBeLessThan(0);
  });
});

describe("CGT Calculator - Exchange Rates", () => {
  it("converts USD trades to GBP using exchange rate", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 150,
        exchangeRate: 1.25,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 180,
        exchangeRate: 1.2,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "AAPL")!;

    // Cost: 10 * 150 / 1.25 = 1200 GBP
    // Proceeds: 10 * 180 / 1.20 = 1500 GBP
    // Gain: 300
    expect(event.gainGBP).toBeCloseTo(300, 0);
  });

  it("GBP trades use exchange rate of 1", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-12-01"),
        symbol: "SHEL",
        type: "buy",
        quantity: 100,
        unitPrice: 26.5,
        exchangeRate: 1.0,
        allowableExpenditure: 11.95,
      }),
      makeTrade({
        date: d("2024-02-15"),
        symbol: "SHEL",
        type: "sell",
        quantity: 100,
        unitPrice: 27.8,
        exchangeRate: 1.0,
        allowableExpenditure: 11.95,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-02-15", "SHEL")!;

    // Proceeds: 100 * 27.80 - 11.95 = 2768.05
    // Cost: 100 * 26.50 + 11.95 = 2661.95
    // Gain: 106.10
    expect(event.gainGBP).toBeCloseTo(106.1, 0);
  });

  it("different exchange rates for buy and sell affect gain", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "COST",
        type: "buy",
        quantity: 15,
        unitPrice: 540,
        exchangeRate: 1.28,
      }),
      makeTrade({
        date: d("2024-11-01"),
        symbol: "COST",
        type: "buy",
        quantity: 10,
        unitPrice: 890,
        exchangeRate: 1.3,
      }),
      makeTrade({
        date: d("2024-12-01"),
        symbol: "COST",
        type: "sell",
        quantity: 25,
        unitPrice: 920,
        exchangeRate: 1.27,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2024-12-01", "COST")!;

    expect(event.gainGBP).toBeGreaterThan(0);
    expect(event.matches[0].rule).toBe("section-104");
  });
});

describe("CGT Calculator - Stock Splits", () => {
  it("pre-split buy has splitFactor applied to quantity and cost", () => {
    const splitEvents: CgSplitEvent[] = [
      { date: d("2022-07-18"), symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
    ];
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-06-15"),
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 113,
      }),
      makeTrade({
        date: d("2023-02-01"),
        symbol: "GOOGL",
        type: "sell",
        quantity: 130,
        unitPrice: 102,
      }),
    ];
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2023-02-01", "GOOGL")!;

    expect(event.matches[0].rule).toBe("section-104");
    // Pre-split: 200 shares @ 113. After 20:1 split: 4000 shares, cost unchanged.
    // Pool cost per share: (200 * 113) / 4000 = 5.65
    const costPerShare = event.matches[0].costGBP / 130;
    expect(costPerShare).toBeCloseTo(5.65, 2);
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(130);
  });
});

describe("CGT Calculator - Tax Year Summaries", () => {
  it("net gain is gains + losses", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "WIN",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-05-01"),
        symbol: "LOSE",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "WIN",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "LOSE",
        type: "sell",
        quantity: 10,
        unitPrice: 60,
      }),
    ];
    const result = runCgt(trades);
    const year = findTaxYear(result, "2022/23")!;

    expect(year.gainsGBP).toBeCloseTo(500, 0);
    expect(year.lossesGBP).toBeCloseTo(-400, 0);
    expect(year.netGainGBP).toBeCloseTo(100, 0);
  });

  it("taxable gain is zero when net gain below annual exempt amount", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades);
    const year = findTaxYear(result, "2022/23")!;

    expect(year.netGainGBP).toBeCloseTo(100, 0);
    expect(year.limits.annualExemptAmount).toBe(12300);
    expect(year.taxableGainGBP).toBe(0);
  });

  it("taxable gain computed when net gain exceeds AEA", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-09-01"),
        symbol: "NVDA",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
    ];
    const result = runCgt(trades);
    const year = findTaxYear(result, "2024/25")!;

    expect(year.netGainGBP).toBeCloseTo(10000, 0);
    expect(year.limits.annualExemptAmount).toBe(3000);
    expect(year.taxableGainGBP).toBeCloseTo(7000, 0);
  });

  it("transfers do not count toward disposal count", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AMZN",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AMZN",
        type: "transfer",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-10-01"),
        symbol: "AMZN",
        type: "sell",
        quantity: 25,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades);
    const year = findTaxYear(result, "2022/23")!;

    expect(year.periods[0].events.filter((e) => e.type === "sell").length).toBe(1);
    expect(year.periods[0].events.filter((e) => e.type === "transfer").length).toBe(1);
  });
});

describe("CGT Calculator - Fractional Shares", () => {
  it("handles fractional buy and sell quantities", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2025-10-15"),
        symbol: "BRK.B",
        type: "buy",
        quantity: 0.5,
        unitPrice: 460,
      }),
      makeTrade({
        date: d("2025-11-01"),
        symbol: "BRK.B",
        type: "buy",
        quantity: 1.75,
        unitPrice: 465,
      }),
      makeTrade({
        date: d("2025-12-01"),
        symbol: "BRK.B",
        type: "sell",
        quantity: 1.0,
        unitPrice: 480,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2025-12-01", "BRK.B")!;

    expect(event.quantity).toBe(1.0);
    expect(event.matches[0].rule).toBe("section-104");
    expect(event.gainGBP).toBeGreaterThan(0);

    const pool = currentPools(result).find((p) => p.symbol === "BRK.B")!;
    expect(pool.shares).toBeCloseTo(1.25, 4);
  });
});

describe("CGT Calculator - Fees (Allowable Expenditure)", () => {
  it("fees increase cost basis and reduce net proceeds", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "TEST",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
        allowableExpenditure: 20,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "TEST",
        type: "sell",
        quantity: 10,
        unitPrice: 110,
        allowableExpenditure: 15,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2022-09-01", "TEST")!;

    // Proceeds: (10*110 - 15) = 1085
    // Cost: (10*100 + 20) = 1020
    // Gain: 65
    expect(event.gainGBP).toBeCloseTo(65, 0);
  });

  it("high fees can turn a nominal gain into a loss", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2025-12-10"),
        symbol: "AZN",
        type: "buy",
        quantity: 20,
        unitPrice: 108,
        allowableExpenditure: 50,
      }),
      makeTrade({
        date: d("2026-01-20"),
        symbol: "AZN",
        type: "sell",
        quantity: 20,
        unitPrice: 112,
        allowableExpenditure: 50,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2026-01-20", "AZN")!;

    // Proceeds: (20*112 - 50) = 2190
    // Cost: (20*108 + 50) = 2210
    // Loss: -20
    expect(event.gainGBP).toBeCloseTo(-20, 0);
  });
});

describe("CGT Calculator - Full Integration (all test trades)", () => {
  const splitEvents: CgSplitEvent[] = [
    { date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
    { date: d("2022-07-18"), symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
  ];

  function makeFullTestTrades(): CgTradeInput[] {
    return [
      {
        date: d("2022-04-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 167.5,
        allowableExpenditure: 5,
        exchangeRate: 1.3,
      },
      {
        date: d("2022-05-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 155.2,
        allowableExpenditure: 5,
        exchangeRate: 1.25,
      },
      {
        date: d("2022-05-15"),
        symbol: "MSFT",
        type: "buy",
        quantity: 40,
        unitPrice: 268,
        allowableExpenditure: 5,
        exchangeRate: 1.25,
      },
      {
        date: d("2022-06-01"),
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 178,
        allowableExpenditure: 5,
        exchangeRate: 1.26,
      },
      {
        date: d("2022-06-15"),
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 113,
        allowableExpenditure: 0,
        exchangeRate: 1.23,
      },
      {
        date: d("2022-07-01"),
        symbol: "AMZN",
        type: "buy",
        quantity: 80,
        unitPrice: 113.5,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        date: d("2022-08-10"),
        symbol: "META",
        type: "buy",
        quantity: 60,
        unitPrice: 168,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        date: d("2022-09-20"),
        symbol: "TSLA",
        type: "buy",
        quantity: 30,
        unitPrice: 303,
        allowableExpenditure: 5,
        exchangeRate: 1.14,
      },
      {
        date: d("2022-10-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 142,
        allowableExpenditure: 5,
        exchangeRate: 1.12,
      },
      {
        date: d("2022-10-15"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 143.5,
        allowableExpenditure: 5,
        exchangeRate: 1.12,
      },
      {
        date: d("2022-11-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 15,
        unitPrice: 230,
        allowableExpenditure: 5,
        exchangeRate: 1.15,
      },
      {
        date: d("2022-11-01"),
        symbol: "MSFT",
        type: "buy",
        quantity: 10,
        unitPrice: 232,
        allowableExpenditure: 0,
        exchangeRate: 1.15,
      },
      {
        date: d("2022-11-01"),
        symbol: "MSFT",
        type: "sell",
        quantity: 40,
        unitPrice: 233,
        allowableExpenditure: 5,
        exchangeRate: 1.15,
      },
      {
        date: d("2022-11-20"),
        symbol: "NVDA",
        type: "sell",
        quantity: 40,
        unitPrice: 155,
        allowableExpenditure: 5,
        exchangeRate: 1.19,
      },
      {
        date: d("2022-11-30"),
        symbol: "NVDA",
        type: "buy",
        quantity: 40,
        unitPrice: 148,
        allowableExpenditure: 5,
        exchangeRate: 1.2,
      },
      {
        date: d("2022-12-05"),
        symbol: "META",
        type: "sell",
        quantity: 60,
        unitPrice: 120,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        date: d("2022-12-20"),
        symbol: "META",
        type: "buy",
        quantity: 25,
        unitPrice: 118,
        allowableExpenditure: 5,
        exchangeRate: 1.2,
      },
      {
        date: d("2023-01-15"),
        symbol: "TSLA",
        type: "sell",
        quantity: 30,
        unitPrice: 122,
        allowableExpenditure: 5,
        exchangeRate: 1.23,
      },
      {
        date: d("2023-02-01"),
        symbol: "GOOGL",
        type: "sell",
        quantity: 80,
        unitPrice: 102,
        allowableExpenditure: 5,
        exchangeRate: 1.23,
      },
      {
        date: d("2023-02-01"),
        symbol: "GOOGL",
        type: "sell",
        quantity: 50,
        unitPrice: 101.5,
        allowableExpenditure: 0,
        exchangeRate: 1.23,
      },
      {
        date: d("2023-03-01"),
        symbol: "AMZN",
        type: "transfer",
        quantity: 40,
        unitPrice: 94,
        allowableExpenditure: 0,
        exchangeRate: 1.21,
      },
    ];
  }

  it("2022/23 tax year summary matches reference", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { splitEvents });
    const year = findTaxYear(result, "2022/23")!;

    // Our calculator merges same-day same-symbol sells into 1 disposal:
    // AAPL(1) + MSFT(1) + NVDA(1) + META(1) + TSLA(1) + GOOGL(1) = 6 disposals + 1 transfer
    expect(year.periods[0].events.filter((e) => e.type === "sell").length).toBe(6);
    // Reference: net gain (gains - losses)
    expect(year.gainsGBP).toBeCloseTo(10511, -2);
    expect(year.lossesGBP).toBeCloseTo(-6566, -2);
    expect(year.netGainGBP).toBeCloseTo(3945, -2);
    expect(year.taxableGainGBP).toBe(0);
  });

  it("GOOGL disposal accounts for 20:1 split (4000 adjusted shares in pool)", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2023-02-01", "GOOGL")!;

    expect(event.matches[0].rule).toBe("section-104");
    // 200 pre-split shares * 20 = 4000 adjusted shares
    const pool = event.poolBefore.find((p) => p.symbol === "GOOGL")!;
    expect(pool.shares).toBeCloseTo(4000, 0);
  });

  it("NVDA disposal matches B&B with 30/11 rebuy", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2022-11-20", "NVDA")!;

    expect(event.matches[0].rule).toBe("bed-and-breakfast");
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(40);
    expect(event.matches[0].matchedDate).toEqual(d("2022-11-30"));
  });

  it("AAPL same-day partial match on 2022-10-15", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2022-10-15", "AAPL")!;

    const sameDay = event.matches.find((m) => m.rule === "same-day");
    const pool = event.matches.find((m) => m.rule === "section-104");

    expect(sameDay).toBeDefined();
    expect(sameDay!.originalMatchedQuantity * event.splitFactor).toBe(20);
    expect(pool).toBeDefined();
    expect(pool!.originalMatchedQuantity * event.splitFactor).toBe(30);
  });
});

describe("CGT Calculator - Bed & Breakfast acquisition dispositions", () => {
  it("records B&B disposition on the acquisition that was matched", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 140,
      }),
    ];
    const result = runCgt(trades);

    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const bAndB = sellEvent.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.originalMatchedQuantity * sellEvent.splitFactor).toBe(30);

    // The buy event that was matched should show the sell as its consumer
    const buyEvent = result.taxYears[0].periods[0].events.find(
      (e) => e.type === "buy" && e.date.getTime() === d("2023-06-15").getTime()
    )!;
    expect(buyEvent).toBeDefined();
    const bAndBMatch = buyEvent.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
    expect(bAndBMatch!.originalMatchedQuantity * buyEvent.splitFactor).toBe(30);
  });

  it("buy consumed by two B&B disposals records correct per-disposal buy-side quantities", () => {
    const trades: CgTradeInput[] = [
      // Seed a pool so the early sells are valid positions.
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Two disposals a few days apart, each 10 shares.
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-05"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      // ONE rebuy of 20 within 30 days of BOTH sells — a single buy with two B&B consumers.
      makeTrade({
        date: d("2023-06-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ];
    const result = runCgt(trades);

    const buyEvent = result.taxYears[0].periods[0].events.find(
      (e) => e.type === "buy" && e.date.getTime() === d("2023-06-20").getTime()
    )!;
    const bnb = buyEvent.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bnb).toHaveLength(2);
    // Each buy-side match must carry only the shares that disposal consumed (10),
    // not the buy's total consumed quantity. The two must sum to the buy's own 20 shares.
    expect(bnb[0].originalMatchedQuantity * buyEvent.splitFactor).toBe(10);
    expect(bnb[1].originalMatchedQuantity * buyEvent.splitFactor).toBe(10);
    const sum = bnb.reduce((s, m) => s + m.originalMatchedQuantity * buyEvent.splitFactor, 0);
    expect(sum).toBe(20);
    // Buy is fully consumed by the two disposals, so nothing enters the pool.
    expect(buyEvent.matches.some((m) => m.rule === "section-104")).toBe(false);
  });
});

describe("CGT Calculator - normalisedTradeId alignment", () => {
  it("match.normalisedTradeId resolves to the correct normalisedTransaction (same-day and B&B)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Same-day buy + sell on 2023-06-01
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 130,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
      // B&B buy within 30 days of the sell
      makeTrade({
        date: d("2023-06-20"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ];
    const result = runCgt(trades);
    const { normalisedTransactions } = result;
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;

    const sameDay = sellEvent.matches.find((m) => m.rule === "same-day")!;
    const bAndB = sellEvent.matches.find((m) => m.rule === "bed-and-breakfast")!;

    // same-day match points at the 2023-06-01 buy
    const sameDayTx = normalisedTransactions.find(
      (t) => t.normalisedTradeId === sameDay.normalisedTradeId
    )!;
    expect(sameDayTx.type).toBe("buy");
    expect(sameDayTx.date).toEqual(d("2023-06-01"));

    // B&B match points at the 2023-06-20 buy
    const bAndBTx = normalisedTransactions.find(
      (t) => t.normalisedTradeId === bAndB.normalisedTradeId
    )!;
    expect(bAndBTx.type).toBe("buy");
    expect(bAndBTx.date).toEqual(d("2023-06-20"));

    // section-104 matches carry no counterparty id
    const pool = sellEvent.matches.find((m) => m.rule === "section-104");
    if (pool) expect(pool.normalisedTradeId).toBeUndefined();
  });
});

describe("CGT Calculator - Pool impact", () => {
  it("returns null poolImpact when buy is fully consumed by same-day match", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const buyEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "buy")!;
    expect(buyEvent.poolImpact).toBeNull();
  });

  it("returns positive shares/costGBP when buy enters pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const buyEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "buy")!;
    const impact = buyEvent.poolImpact;
    expect(impact).not.toBeNull();
    expect(impact!.sharesDelta).toBe(100);
    expect(impact!.costDeltaGBP).toBeCloseTo(5000);
  });

  it("returns negative shares/costGBP when sell matches pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 70,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const impact = sellEvent.poolImpact;
    expect(impact).not.toBeNull();
    expect(impact!.sharesDelta).toBe(-40);
    expect(impact!.costDeltaGBP).toBeCloseTo(-2000);
  });

  it("returns null poolImpact for sell fully matched by same-day rule", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.poolImpact).toBeNull();
  });
});

describe("CGT Calculator - Input validation", () => {
  it("throws CgValidationError on invalid input", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: -5,
        unitPrice: 100,
      }),
    ];
    expect(() => calculateCgt(trades)).toThrow(CgValidationError);
    try {
      calculateCgt(trades);
    } catch (e) {
      const err = e as CgValidationError;
      expect(err.errors[0].message).toContain("Quantity must be positive");
      expect(err.errors[0].index).toBe(0);
    }
  });

  it("throws on pre-2008 trade", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2007-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
    ];
    expect(() => calculateCgt(trades)).toThrow(CgValidationError);
    try {
      calculateCgt(trades);
    } catch (e) {
      const err = e as CgValidationError;
      expect(err.errors[0].message).toContain("the earliest supported tax year is 2008/09");
    }
  });

  it("throws with all validation errors at once", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2007-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: -5,
        unitPrice: -1,
      }),
    ];
    expect(() => calculateCgt(trades)).toThrow(CgValidationError);
    try {
      calculateCgt(trades);
    } catch (e) {
      const err = e as CgValidationError;
      expect(err.errors.length).toBeGreaterThan(1);
    }
  });
});

describe("CGT Calculator - Transfer disposals", () => {
  it("creates a transfer disposal with pool impact", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 40,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer");
    expect(transfer).toBeDefined();
    const impact = transfer!.poolImpact;
    expect(impact).not.toBeNull();
    expect(impact!.sharesDelta).toBe(-40);
    expect(transfer!.gainGBP).toBe(0);
  });
});

describe("CGT Calculator - Multiple tax years with pool snapshots", () => {
  it("captures pool snapshots when disposals span multiple tax years", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2022-08-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-08-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 20,
        unitPrice: 160,
      }),
    ];
    const result = runCgt(trades);
    expect(result.taxYears).toHaveLength(2);
    const year2223 = findTaxYear(result, "2022/23")!;
    expect(year2223.poolAtYearEnd).toBeDefined();
    expect(year2223.poolAtYearEnd[0].shares).toBe(70);
  });
});

describe("CGT Calculator - Empty pool and no-match cases", () => {
  it("sell fully matched by same-day — no pool interaction", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    expect(currentPools(result)).toHaveLength(0);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.matches[0].rule).toBe("same-day");
    expect(sellEvent.poolImpact).toBeNull();
  });

  it("sell with empty pool and no B&B — only same-day match available", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.matches[0].rule).toBe("same-day");
    expect(currentPools(result)).toHaveLength(0);
  });

  it("rejects selling shares before they are bought (B&B is tax matching, not physical execution)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 30,
        unitPrice: 150,
      }),
      // Pool is empty after the same-day match. The next sell pre-dates the next buy.
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 20,
        unitPrice: 160,
      }),
      makeTrade({
        date: d("2023-06-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 140,
      }),
    ];
    expect(() => runCgt(trades)).toThrow(CgValidationError);
  });

  it("acquisition with no sell matches has pool disposition", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const buyEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "buy")!;
    expect(buyEvent.matches).toHaveLength(1);
    expect(buyEvent.matches[0].rule).toBe("section-104");
  });
});

describe("CGT Calculator - Edge cases for branch coverage", () => {
  it("handles calculateCgt with no options", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
    ];
    const result = runCgt(trades);
    expect(result.taxYears).toHaveLength(1);
  });

  it("sorts trades with later date first (covers a.date > b.date branch)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 5,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.date).toEqual(d("2023-06-01"));
  });

  it("merges same-date same-symbol buys regardless of input order", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 5,
        unitPrice: 90,
      }),
    ];
    const result = runCgt(trades);
    const buyEvents = result.taxYears[0].periods[0].events.filter((e) => e.type === "buy");
    expect(buyEvents).toHaveLength(1);
  });

  it("same-day sell with multiple same-day buys where first covers all", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 90,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 95,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 80,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.matches[0].rule).toBe("same-day");
    expect(sellEvent.matches[0].originalMatchedQuantity * sellEvent.splitFactor).toBe(80);
  });

  it("same-day sell consuming shares from multiple buys (exhausts first buy)", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 90,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 95,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 60,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.matches[0].rule).toBe("same-day");
    expect(sellEvent.matches[0].originalMatchedQuantity * sellEvent.splitFactor).toBe(60);
  });

  it("B&B with multiple buys in 30 days where first covers the sell", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 80,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 20,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-01-05"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 140,
      }),
      makeTrade({
        date: d("2023-01-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 145,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const bAndB = sellEvent.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.originalMatchedQuantity * sellEvent.splitFactor).toBe(20);
  });

  it("handles empty trade list", () => {
    const result = runCgt([]);
    expect(result.taxYears).toHaveLength(0);
    expect(currentPools(result)).toHaveLength(0);
  });

  it("handles transfer with pool impact tracking", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-03-01"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const transfer = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.poolAfter.length).toBeGreaterThan(0);
  });

  it("pure pool sell (no same-day/B&B) uses sellMatches fallback", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 80,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(sellEvent.matches).toHaveLength(1);
    expect(sellEvent.matches[0].rule).toBe("section-104");
  });

  it("buy fully consumed by B&B has null poolImpact", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 80,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-06-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 140,
      }),
    ];
    const result = runCgt(trades);
    const bAndBAcquisition = result.taxYears[0].periods[0].events.find(
      (e) => e.type === "buy" && e.date.getTime() === d("2023-06-10").getTime()
    );
    expect(bAndBAcquisition).toBeDefined();
    expect(bAndBAcquisition!.poolImpact).toBeNull();
  });

  it("sell matching partially from same-day and partially from pool", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-06-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 80,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const sellEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const sameDay = sellEvent.matches.find((m) => m.rule === "same-day");
    const pool = sellEvent.matches.find((m) => m.rule === "section-104");
    expect(sameDay).toBeDefined();
    expect(sameDay!.originalMatchedQuantity * sellEvent.splitFactor).toBe(20);
    expect(pool).toBeDefined();
    expect(pool!.originalMatchedQuantity * sellEvent.splitFactor).toBe(30);
    const impact = sellEvent.poolImpact;
    expect(impact).not.toBeNull();
    expect(impact!.sharesDelta).toBe(-30);
  });
});

describe("CGT Calculator - Tax rate computation", () => {
  it("computes tax at basic and higher rates for a single period year", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Gain = 10000, AEA = 6000, taxable = 4000
    expect(year.taxableGainGBP).toBe(4000);
    // 2023/24 rates: 10% basic, 20% higher
    expect(year.taxBasicGBP).toBeCloseTo(400);
    expect(year.taxHigherGBP).toBeCloseTo(800);
    expect(year.periods).toHaveLength(1);
    expect(year.periods[0].period.basicRate).toBe(10);
    expect(year.periods[0].period.higherRate).toBe(20);
  });

  it("computes tax across two rate periods in 2024/25", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-06-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Sell before 30 Oct — rates 10%/20%
      makeTrade({
        date: d("2024-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 150,
      }),
      // Sell after 30 Oct — rates 18%/24%
      makeTrade({
        date: d("2024-11-15"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    expect(year.periods).toHaveLength(2);

    // AEA (3000) deducted from total net gain (10000), taxable = 7000.
    // HMRC allocates the AEA to the highest-rate period first (CG21520): the
    // post-30-Oct period (18%/24%) absorbs the whole £3,000 AEA, so P1 (10%/20%)
    // stays fully taxable on its £5,000.
    const p1 = year.periods[0];
    expect(p1.period.basicRate).toBe(10);
    expect(p1.period.higherRate).toBe(20);
    expect(p1.gainsGBP).toBe(5000);
    expect(p1.allocatedAEA).toBe(0);
    expect(p1.taxableGainGBP).toBe(5000);
    expect(p1.taxBasicGBP).toBeCloseTo(500);
    expect(p1.taxHigherGBP).toBeCloseTo(1000);

    const p2 = year.periods[1];
    expect(p2.period.basicRate).toBe(18);
    expect(p2.period.higherRate).toBe(24);
    expect(p2.gainsGBP).toBe(5000);
    expect(p2.allocatedAEA).toBe(3000);
    expect(p2.taxableGainGBP).toBe(2000);
    expect(p2.taxBasicGBP).toBeCloseTo(360);
    expect(p2.taxHigherGBP).toBeCloseTo(480);

    // Year totals — the AEA reduces the year's taxable gain to 7000 regardless of
    // how it is split across periods; the split only moves which rate band applies.
    expect(year.taxableGainGBP).toBe(7000);
    expect(year.taxBasicGBP).toBeCloseTo(860);
    expect(year.taxHigherGBP).toBeCloseTo(1480);
  });

  it("loss in period 1 offsets gain in period 2 — net below AEA means no tax", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-05-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Period 1: sell at loss (gain = -1000)
      makeTrade({
        date: d("2024-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 90,
      }),
      // Period 2: sell at profit (gain = 2000)
      makeTrade({
        date: d("2024-11-15"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Total net: -1000 + 2000 = 1000, below AEA of 3000 → no tax
    expect(year.netGainGBP).toBe(1000);
    expect(year.taxableGainGBP).toBe(0);
    expect(year.taxBasicGBP).toBe(0);
    expect(year.taxHigherGBP).toBe(0);
  });

  it("loss in period 1 offsets gain in period 2 — net above AEA, tax only on excess", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-05-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Period 1: loss of 1000
      makeTrade({
        date: d("2024-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 90,
      }),
      // Period 2: gain of 4100
      makeTrade({
        date: d("2024-11-15"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 141,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Net: -1000 + 4100 = 3100, minus AEA 3000 → taxable = 100
    expect(year.netGainGBP).toBe(3100);
    expect(year.taxableGainGBP).toBeCloseTo(100);
    // Only period 2 has positive gains so all taxable goes there (at 18%/24%)
    expect(year.periods[1].taxableGainGBP).toBeCloseTo(100);
    expect(year.periods[1].taxBasicGBP).toBeCloseTo(18);
    expect(year.periods[1].taxHigherGBP).toBeCloseTo(24);
  });

  it("gains in both periods — AEA deducted from the highest-rate period first", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-05-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Period 1: gain of 3000
      makeTrade({
        date: d("2024-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 130,
      }),
      // Period 2: gain of 3000
      makeTrade({
        date: d("2024-11-15"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 130,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Net: 6000, minus AEA 3000 → taxable = 3000.
    // Highest-rate-first: the post-30-Oct period (18%/24%) takes the full £3,000
    // AEA, leaving its taxable gain at 0; Period 1 (10%/20%) stays fully taxable.
    expect(year.taxableGainGBP).toBe(3000);
    expect(year.periods[0].allocatedAEA).toBe(0);
    expect(year.periods[0].taxableGainGBP).toBe(3000);
    expect(year.periods[1].allocatedAEA).toBe(3000);
    expect(year.periods[1].taxableGainGBP).toBe(0);
    // Period 1 at 10%/20%, Period 2 at 18%/24%
    expect(year.periods[0].taxBasicGBP).toBeCloseTo(300);
    expect(year.periods[0].taxHigherGBP).toBeCloseTo(600);
    expect(year.periods[1].taxBasicGBP).toBeCloseTo(0);
    expect(year.periods[1].taxHigherGBP).toBeCloseTo(0);
  });

  it("allocates the AEA to the higher-rate period first (HMRC CG21520 worked example)", () => {
    // Period 1 (pre-30-Oct, 10%/20%) gain £10,000; Period 2 (post-30-Oct, 18%/24%)
    // gain £2,000; AEA £3,000. HMRC sets the AEA against the highest-rate gains
    // first: £2,000 wipes out Period 2 entirely, the remaining £1,000 reduces
    // Period 1 to £9,000 taxable.
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2024-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2024-05-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      // Period 1: gain 10000
      makeTrade({
        date: d("2024-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
      // Period 2: gain 2000
      makeTrade({
        date: d("2024-11-15"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    const [p1, p2] = year.periods;
    // Higher-rate period (P2) is fully exempted first.
    expect(p2.allocatedAEA).toBe(2000);
    expect(p2.taxableGainGBP).toBe(0);
    // Remainder of the AEA spills into the lower-rate period.
    expect(p1.allocatedAEA).toBe(1000);
    expect(p1.taxableGainGBP).toBe(9000);

    // Year taxable = 12000 - 3000 = 9000, all in the 10%/20% band.
    expect(year.taxableGainGBP).toBe(9000);
    expect(year.taxBasicGBP).toBeCloseTo(900);
    expect(year.taxHigherGBP).toBeCloseTo(1800);
  });

  it("AEA fully absorbs gains — zero tax", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "XYZ",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "XYZ",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Gain = 2000, AEA = 6000
    expect(year.taxableGainGBP).toBe(0);
    expect(year.taxBasicGBP).toBe(0);
    expect(year.taxHigherGBP).toBe(0);
  });

  it("losses reduce taxable gain before tax computation", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "WIN",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-05-01"),
        symbol: "LOSE",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "WIN",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "LOSE",
        type: "sell",
        quantity: 100,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const year = result.taxYears[0];

    // Gain 10000, Loss -5000, Net 5000, AEA 6000, taxable 0
    expect(year.gainsGBP).toBe(10000);
    expect(year.lossesGBP).toBe(-5000);
    expect(year.netGainGBP).toBe(5000);
    expect(year.taxableGainGBP).toBe(0);
    expect(year.taxBasicGBP).toBe(0);
  });
});

describe("CGT Calculator - Match helper coverage", () => {
  it("Match.getGainGBP returns gain for a sell match", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 70,
      }),
    ];
    const result = runCgt(trades);
    const event = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    const gain = event.matches[0].gainGBP;
    // Proceeds per share = 70, cost per share = 50, qty = 40: gain = 40*(70-50) = 800
    expect(gain).toBeCloseTo(800, 0);
  });

  it("Match.getMatchedDate returns undefined for section-104 match", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 70,
      }),
    ];
    const result = runCgt(trades);
    const event = result.taxYears[0].periods[0].events.find((e) => e.type === "sell")!;
    expect(event.matches[0].rule).toBe("section-104");
    expect(event.matches[0].matchedDate).toBeUndefined();
  });

  it("section-104 match cost is 0 when the pool is empty", () => {
    // calculateCgt never produces this (position validation guarantees a pool),
    // but the derivation must defend against an empty/zero pool. Exercise it directly.
    const ctx: EventDeriveContext = {
      type: "sell",
      symbol: "AAPL",
      splitFactor: 1,
      quantity: 10,
      valueGBP: 500,
      poolBefore: [],
    };
    const fakeMatch = { rule: "section-104" as const, originalMatchedQuantity: 10 };
    expect(deriveMatchCostGBP(fakeMatch, ctx, [])).toBe(0);
  });

  it("event gain is 0 for a sell with no matched shares", () => {
    // calculateCgt always produces fully-matched sells, but the derivation must
    // defend against matchedQty === 0. Exercise it directly.
    const ctx: EventDeriveContext = {
      type: "sell",
      symbol: "AAPL",
      splitFactor: 1,
      quantity: 10,
      valueGBP: 500,
      poolBefore: [],
    };
    expect(deriveEventGainGBP(ctx, [], 0)).toBe(0);
  });

  it("Match.getGainGBP returns 0 for a transfer match", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "transfer",
        quantity: 40,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades);
    const event = result.taxYears[0].periods[0].events.find((e) => e.type === "transfer")!;
    const gain = event.matches[0].gainGBP;
    expect(gain).toBe(0);
  });
});

describe("CGT Calculator - Sell with no buys for symbol", () => {
  it("throws CgValidationError when selling shares never bought", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "ORPHAN",
        type: "sell",
        quantity: 10,
        unitPrice: 60,
      }),
    ];
    expect(() => runCgt(trades)).toThrow(CgValidationError);
  });
});

describe("CGT Calculator - Compounding stock splits", () => {
  it("correctly handles two splits on the same symbol (4:1 then 2:1 = 8x)", () => {
    const splitEvents: CgSplitEvent[] = [
      { date: d("2022-08-31"), symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
      { date: d("2023-06-06"), symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
    ];
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 320,
      }),
      makeTrade({
        date: d("2024-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2024-01-01", "AAPL")!;

    expect(event.matches[0].rule).toBe("section-104");
    // 10 pre-split shares × 8 (4×2) = 80 adjusted shares in pool
    // Total cost unchanged: 10 × 320 = 3200
    // Cost per adjusted share: 3200 / 80 = 40
    const costPerShare = event.matches[0].costGBP / 40;
    expect(costPerShare).toBeCloseTo(40, 2);
    expect(event.matches[0].originalMatchedQuantity * event.splitFactor).toBe(40);
    // Gain: 40 × 50 - 40 × 40 = 2000 - 1600 = 400
    expect(event.gainGBP).toBeCloseTo(400, 0);

    // Remaining pool: 40 shares, cost 1600
    const pool = currentPools(result).find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBeCloseTo(40, 4);
    expect(pool.costGBP).toBeCloseTo(1600, 0);
  });

  it("buy between two splits only gets the second split applied", () => {
    const splitEvents: CgSplitEvent[] = [
      { date: d("2022-08-31"), symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
      { date: d("2023-06-06"), symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
    ];
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-05-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 320,
      }),
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 130,
      }),
      makeTrade({
        date: d("2024-01-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { splitEvents });
    const event = findSellEvent(result, "2024-01-01", "AAPL")!;

    // Trade 1: 10 shares × 8 factor = 80 adjusted, cost 3200
    // Trade 2: 40 shares × 2 factor = 80 adjusted, cost 5200
    // Pool: 160 shares, cost 8400, avg cost = 52.50
    expect(event.matches[0].rule).toBe("section-104");
    const costPerShare = event.matches[0].costGBP / 100;
    expect(costPerShare).toBeCloseTo(52.5, 2);
    // Gain: 100 × 50 - 100 × 52.50 = 5000 - 5250 = -250 (loss)
    expect(event.gainGBP).toBeCloseTo(-250, 0);
  });
});

describe("CGT Calculator - Loss carry-forward prohibition", () => {
  it("losses in one tax year do NOT reduce gains in a subsequent tax year", () => {
    const trades: CgTradeInput[] = [
      // 2022/23: loss of £1000
      makeTrade({
        date: d("2022-06-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 20,
      }),
      makeTrade({
        date: d("2022-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 100,
        unitPrice: 10,
      }),
      // 2023/24: gain of £500
      makeTrade({
        date: d("2023-06-01"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "BBB",
        type: "sell",
        quantity: 100,
        unitPrice: 55,
      }),
    ];
    const result = runCgt(trades);
    const year2022 = findTaxYear(result, "2022/23")!;
    const year2023 = findTaxYear(result, "2023/24")!;

    // Year 1 has a loss
    expect(year2022.lossesGBP).toBeCloseTo(-1000, 0);
    expect(year2022.gainsGBP).toBe(0);
    expect(year2022.taxableGainGBP).toBe(0);

    // Year 2 gain is NOT reduced by prior year's loss — each year is independent
    expect(year2023.gainsGBP).toBeCloseTo(500, 0);
    expect(year2023.netGainGBP).toBeCloseTo(500, 0);
  });
});

describe("CGT Calculator - SHARE_TOLERANCE boundary", () => {
  it("treats remaining shares at exactly SHARE_TOLERANCE as fully consumed", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10.0001,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10.0001,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    expect(currentPools(result)).toHaveLength(0);
  });

  it("treats remaining shares above SHARE_TOLERANCE as real remainder", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10.001,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades);
    const pool = currentPools(result).find((p) => p.symbol === "AAPL");
    expect(pool).toBeDefined();
    expect(pool!.shares).toBeCloseTo(0.001, 4);
  });
});

describe("CGT Calculator - Integration: FX + fees + fractional + multi-match", () => {
  it("correctly handles combined FX conversion, fees, and multiple matching rules", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-15"),
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 150,
        allowableExpenditure: 12,
        exchangeRate: 1.25,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 160,
        allowableExpenditure: 5,
        exchangeRate: 1.3,
      }),
      makeTrade({
        date: d("2023-06-10"),
        symbol: "AAPL",
        type: "buy",
        quantity: 5,
        unitPrice: 155,
        allowableExpenditure: 3,
        exchangeRate: 1.28,
      }),
      makeTrade({
        date: d("2023-06-01"),
        symbol: "AAPL",
        type: "sell",
        quantity: 25,
        unitPrice: 170,
        allowableExpenditure: 15,
        exchangeRate: 1.27,
      }),
    ];
    const result = runCgt(trades);
    const event = findSellEvent(result, "2023-06-01", "AAPL")!;

    // Should have at least same-day triggered
    expect(event.matches.length).toBeGreaterThanOrEqual(2);
    const rules = event.matches.map((m) => m.rule);
    expect(rules).toContain("same-day");

    // Total gain should be consistent: proceeds - costs across all matches
    const totalMatchCost = event.costGBP;
    expect(event.gainGBP).toBeCloseTo(event.valueGBP - totalMatchCost, 2);
  });
});

describe("CGT Calculator - 2010/11 mid-year rate change (23 June 2010)", () => {
  // HMRC changed CGT for individuals from a flat 18% to 18%/28% on 23 June 2010
  // (CG10246). The 2010/11 tax year therefore splits into two rate periods, and a
  // gain realised before 23 June 2010 must be charged at 18% even for a higher-rate
  // taxpayer — not the 28% that applies from 23 June onwards.
  function build2010Disposals(): CgTradeInput[] {
    return [
      // A: bought 2009, disposed 1 May 2010 (pre 23 Jun) — gain 50,000.
      makeTrade({
        date: d("2009-06-01"),
        symbol: "PRE",
        type: "buy",
        quantity: 1000,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2010-05-01"),
        symbol: "PRE",
        type: "sell",
        quantity: 1000,
        unitPrice: 150,
      }),
      // B: bought 2009, disposed 1 Jul 2010 (post 23 Jun) — gain 20,000.
      makeTrade({
        date: d("2009-06-01"),
        symbol: "POST",
        type: "buy",
        quantity: 1000,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2010-07-01"),
        symbol: "POST",
        type: "sell",
        quantity: 1000,
        unitPrice: 120,
      }),
    ];
  }

  it("splits 2010/11 into a flat-18% period and an 18/28 period", () => {
    const result = runCgt(build2010Disposals());
    const year = result.taxYears.find((y) => y.taxYear === "2010/11")!;
    expect(year.periods).toHaveLength(2);
    expect(year.periods[0].period).toMatchObject({ basicRate: 18, higherRate: 18 });
    expect(year.periods[1].period).toMatchObject({ basicRate: 18, higherRate: 28 });
  });

  it("charges a pre-23-June-2010 disposal at 18% even at the higher rate", () => {
    const trades = build2010Disposals();
    const result = runCgt(trades);
    const year = result.taxYears.find((y) => y.taxYear === "2010/11")!;
    const prePeriod = year.periods[0];

    expect(prePeriod.netGainGBP).toBeCloseTo(50000, 2);
    // Higher-rate tax on the pre-period gain uses 18%, not 28%.
    expect(prePeriod.taxHigherGBP).toBeCloseTo(50000 * 0.18, 2);
    expect(prePeriod.taxBasicGBP).toBeCloseTo(50000 * 0.18, 2);
  });

  it("allocates the AEA to the post-23-June (28%) period first", () => {
    const trades = build2010Disposals();
    const result = runCgt(trades);
    const year = result.taxYears.find((y) => y.taxYear === "2010/11")!;
    const [prePeriod, postPeriod] = year.periods;

    // AEA (£10,100) is set against the highest-rate gains first (CG21520) — the
    // 28% post-period — leaving the 18% pre-period gain fully exposed.
    expect(prePeriod.allocatedAEA).toBeCloseTo(0, 2);
    expect(postPeriod.allocatedAEA).toBeCloseTo(10100, 2);
    expect(postPeriod.taxableGainGBP).toBeCloseTo(20000 - 10100, 2);
    expect(postPeriod.taxHigherGBP).toBeCloseTo((20000 - 10100) * 0.28, 2);

    // Year-level taxable total is unaffected by the split: 70,000 - 10,100.
    expect(year.taxableGainGBP).toBeCloseTo(59900, 2);
  });
});

describe("CGT Calculator - Reporting, counts, and remaining AEA fields", () => {
  it("flags reportingRequired with a taxable-gain reason when net gain exceeds the AEA", () => {
    // 2023/24 AEA £6,000, reporting threshold £50,000. Gain £10,000 > AEA, proceeds £20,000 < threshold.
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "BIG",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "BIG",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    expect(year.taxableGainGBP).toBeCloseTo(4000, 2);
    expect(year.reportingRequired).toBe(true);
    expect(year.reportingReasons).toEqual(["taxable-gain"]);
  });

  it("flags reportingRequired on proceeds alone when gains are within the AEA but proceeds exceed the threshold", () => {
    // 2023/24 threshold £50,000. Proceeds £60,000, gain only £3,000 (< £6,000 AEA).
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "VOL",
        type: "buy",
        quantity: 1000,
        unitPrice: 57,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "VOL",
        type: "sell",
        quantity: 1000,
        unitPrice: 60,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    expect(year.proceedsGBP).toBeCloseTo(60000, 2);
    expect(year.taxableGainGBP).toBe(0);
    expect(year.reportingRequired).toBe(true);
    expect(year.reportingReasons).toEqual(["proceeds-exceed-threshold"]);
  });

  it("reports both reasons when gain exceeds the AEA and proceeds exceed the threshold", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "BIG",
        type: "buy",
        quantity: 1000,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "BIG",
        type: "sell",
        quantity: 1000,
        unitPrice: 200,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    expect(year.proceedsGBP).toBeCloseTo(200000, 2);
    expect(year.taxableGainGBP).toBeGreaterThan(0);
    expect(year.reportingRequired).toBe(true);
    expect(year.reportingReasons).toEqual(["taxable-gain", "proceeds-exceed-threshold"]);
  });

  it("does not require reporting when gains are within the AEA and proceeds are below the threshold", () => {
    const trades: CgTradeInput[] = [
      makeTrade({ date: d("2023-05-01"), symbol: "SM", type: "buy", quantity: 10, unitPrice: 100 }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "SM",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    expect(year.reportingRequired).toBe(false);
    expect(year.reportingReasons).toEqual([]);
  });

  it("remainingAEAGBP is the AEA minus realised net gain, clamped to the statutory AEA in a net-loss year", () => {
    // Net loss: AEA must not be inflated above the statutory £6,000 (2023/24).
    const lossTrades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "DOWN",
        type: "buy",
        quantity: 100,
        unitPrice: 200,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "DOWN",
        type: "sell",
        quantity: 100,
        unitPrice: 100,
      }),
    ];
    const lossYear = runCgt(lossTrades).taxYears[0];
    expect(lossYear.netGainGBP).toBeLessThan(0);
    expect(lossYear.remainingAEAGBP).toBeCloseTo(6000, 2);

    // Partial gain: remaining AEA = 6000 - 2000 = 4000.
    const gainTrades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "UP",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "UP",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const gainYear = runCgt(gainTrades).taxYears[0];
    expect(gainYear.netGainGBP).toBeCloseTo(2000, 2);
    expect(gainYear.remainingAEAGBP).toBeCloseTo(4000, 2);
  });

  it("counts disposals (sells + transfers) and acquisitions (buys) at period and year level", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-05-02"),
        symbol: "BBB",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
      }),
      makeTrade({
        date: d("2023-09-02"),
        symbol: "BBB",
        type: "transfer",
        quantity: 30,
        unitPrice: 150,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    // 2 buys, 1 sell + 1 transfer = 2 disposals.
    expect(year.acquisitionCount).toBe(2);
    expect(year.disposalCount).toBe(2);
    expect(year.periods.reduce((s, p) => s + p.disposalCount, 0)).toBe(2);
    expect(year.periods.reduce((s, p) => s + p.acquisitionCount, 0)).toBe(2);
  });

  it("bakes split-adjusted quantity onto events and normalised transactions", () => {
    const splitEvents: CgSplitEvent[] = [
      { date: d("2023-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
    ];
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-01-10"),
        symbol: "AMZN",
        type: "buy",
        quantity: 15,
        unitPrice: 100,
      }),
    ];
    const result = runCgt(trades, { splitEvents });
    // 15 pre-split shares × 20 = 300 post-split.
    expect(result.normalisedTransactions[0].quantity).toBe(300);
    const buyEvent = result.taxYears[0].periods[0].events.find((e) => e.type === "buy")!;
    expect(buyEvent.quantity).toBe(300);
  });

  it("surfaces a transfer's input fee on its event without affecting gain or value", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "VOD",
        type: "buy",
        quantity: 1000,
        unitPrice: 1.2,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "VOD",
        type: "transfer",
        quantity: 400,
        unitPrice: 1.2,
        allowableExpenditure: 7,
      }),
    ];
    const transfer = runCgt(trades).taxYears[0].periods[0].events.find(
      (e) => e.type === "transfer"
    )!;
    // The customer-provided fee is now exposed (was zeroed before)...
    expect(transfer.feesGBP).toBeCloseTo(7, 6);
    // ...but the transfer is still no-gain/no-loss with zero proceeds.
    expect(transfer.gainGBP).toBe(0);
    expect(transfer.valueGBP).toBe(0);
  });

  it("aggregates feesGBP across buys, sells, and transfers at period and year level", () => {
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-05-01"),
        symbol: "AAA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
        allowableExpenditure: 10,
      }),
      makeTrade({
        date: d("2023-09-01"),
        symbol: "AAA",
        type: "sell",
        quantity: 40,
        unitPrice: 150,
        allowableExpenditure: 8,
      }),
      makeTrade({
        date: d("2023-10-01"),
        symbol: "AAA",
        type: "transfer",
        quantity: 30,
        unitPrice: 150,
        allowableExpenditure: 3,
      }),
    ];
    const year = runCgt(trades).taxYears[0];
    // 10 (buy) + 8 (sell) + 3 (transfer) = 21 — includes buy & transfer fees, not sell-only.
    expect(year.feesGBP).toBeCloseTo(21, 6);
    // Year equals the sum of its periods.
    expect(year.periods.reduce((s, p) => s + p.feesGBP, 0)).toBeCloseTo(21, 6);
  });
});

describe("dates carrying a time-of-day (only the UTC calendar day matters)", () => {
  it("same-day matches a buy and sell that share a calendar day but differ in time", () => {
    // Cheap old pool + expensive same-day buy + same-day sell. If the time-of-day
    // leaked into the same-day comparison, the sell would wrongly fall to the pool
    // average (cost 2550, gain 3450) instead of the same-day buy (cost 5000, gain 1000).
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2022-01-10T00:00:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 1,
      }),
      makeTrade({
        date: d("2023-03-01T10:00:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-03-01T15:00:00Z"),
        symbol: "X",
        type: "sell",
        quantity: 100,
        unitPrice: 60,
      }),
    ];
    const sell = findSellEvent(runCgt(trades), "2023-03-01", "X");
    expect(sell?.matches.map((m) => m.rule)).toEqual(["same-day"]);
    expect(sell?.costGBP).toBeCloseTo(5000, 6);
    expect(sell?.gainGBP).toBeCloseTo(1000, 6);
  });

  it("matches the same regardless of whether inputs carry a time-of-day", () => {
    const withTime: CgTradeInput[] = [
      makeTrade({
        date: d("2022-01-10T08:30:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 1,
      }),
      makeTrade({
        date: d("2023-03-01T10:00:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: d("2023-03-01T15:00:00Z"),
        symbol: "X",
        type: "sell",
        quantity: 100,
        unitPrice: 60,
      }),
    ];
    const midnight: CgTradeInput[] = [
      makeTrade({ date: d("2022-01-10"), symbol: "X", type: "buy", quantity: 100, unitPrice: 1 }),
      makeTrade({ date: d("2023-03-01"), symbol: "X", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({ date: d("2023-03-01"), symbol: "X", type: "sell", quantity: 100, unitPrice: 60 }),
    ];
    const a = findSellEvent(runCgt(withTime), "2023-03-01", "X");
    const b = findSellEvent(runCgt(midnight), "2023-03-01", "X");
    expect(a?.gainGBP).toBeCloseTo(b?.gainGBP ?? NaN, 6);
    expect(a?.matches.map((m) => m.rule)).toEqual(b?.matches.map((m) => m.rule));
  });

  it("composites multiple same-day buys at different times before a same-day sell", () => {
    // Two buys on the same calendar day (09:00 and 14:00) form the weighted-average
    // same-day composite the 16:00 sell matches against: (100*10 + 100*30)/200 = 20.
    const trades: CgTradeInput[] = [
      makeTrade({
        date: d("2023-03-01T09:00:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 10,
      }),
      makeTrade({
        date: d("2023-03-01T14:00:00Z"),
        symbol: "X",
        type: "buy",
        quantity: 100,
        unitPrice: 30,
      }),
      makeTrade({
        date: d("2023-03-01T16:00:00Z"),
        symbol: "X",
        type: "sell",
        quantity: 200,
        unitPrice: 50,
      }),
    ];
    const sell = findSellEvent(runCgt(trades), "2023-03-01", "X");
    expect(sell?.matches.map((m) => m.rule)).toEqual(["same-day"]);
    expect(sell?.costGBP).toBeCloseTo(4000, 6); // 200 shares * £20 average
    expect(sell?.gainGBP).toBeCloseTo(6000, 6); // 200 * (50 - 20)
  });

  it("counts the 30-day B&B window by calendar day, unaffected by time-of-day", () => {
    // Sell 1 Feb, repurchase 3 Mar = exactly 30 calendar days (within the window).
    // A late-day sell + early-day buy previously rounded to 29 days; a +14h gap could
    // also push it to 31. By calendar day it is always day 30 → bed-and-breakfast.
    const onDay30 = (sellTime: string, buyTime: string): string[] | undefined => {
      const trades: CgTradeInput[] = [
        makeTrade({ date: d("2022-01-01"), symbol: "Y", type: "buy", quantity: 100, unitPrice: 5 }),
        makeTrade({
          date: d("2023-02-01T" + sellTime),
          symbol: "Y",
          type: "sell",
          quantity: 100,
          unitPrice: 9,
        }),
        makeTrade({
          date: d("2023-03-03T" + buyTime),
          symbol: "Y",
          type: "buy",
          quantity: 100,
          unitPrice: 7,
        }),
      ];
      return findSellEvent(runCgt(trades), "2023-02-01", "Y")?.matches.map((m) => m.rule);
    };
    expect(onDay30("00:00:00Z", "00:00:00Z")).toEqual(["bed-and-breakfast"]);
    expect(onDay30("09:00:00Z", "23:00:00Z")).toEqual(["bed-and-breakfast"]);
    expect(onDay30("23:00:00Z", "01:00:00Z")).toEqual(["bed-and-breakfast"]);
  });

  it("excludes a repurchase 31 calendar days later regardless of time-of-day", () => {
    // Sell 1 Feb, repurchase 4 Mar = 31 calendar days → outside the window, pools instead.
    const trades: CgTradeInput[] = [
      makeTrade({ date: d("2022-01-01"), symbol: "Y", type: "buy", quantity: 100, unitPrice: 5 }),
      makeTrade({
        date: d("2023-02-01T23:00:00Z"),
        symbol: "Y",
        type: "sell",
        quantity: 100,
        unitPrice: 9,
      }),
      makeTrade({
        date: d("2023-03-04T01:00:00Z"),
        symbol: "Y",
        type: "buy",
        quantity: 100,
        unitPrice: 7,
      }),
    ];
    const sell = findSellEvent(runCgt(trades), "2023-02-01", "Y");
    expect(sell?.matches.map((m) => m.rule)).toEqual(["section-104"]);
  });

  it("does not mutate the caller's input dates", () => {
    const original = d("2023-03-01T15:45:30Z");
    const trades: CgTradeInput[] = [
      makeTrade({ date: d("2023-02-10"), symbol: "X", type: "buy", quantity: 100, unitPrice: 10 }),
      makeTrade({ date: original, symbol: "X", type: "sell", quantity: 50, unitPrice: 20 }),
    ];
    runCgt(trades);
    expect(original.toISOString()).toBe("2023-03-01T15:45:30.000Z");
    expect(trades[1].date).toBe(original);
  });

  it("normalises split-event dates to the calendar day too", () => {
    // Split takes effect 2 Jun; a buy on 1 Jun is pre-split and must be adjusted 1:2
    // even though the split date carries an afternoon timestamp.
    const trades: CgTradeInput[] = [
      makeTrade({ date: d("2023-06-01"), symbol: "Z", type: "buy", quantity: 100, unitPrice: 10 }),
      makeTrade({ date: d("2023-07-01"), symbol: "Z", type: "sell", quantity: 200, unitPrice: 8 }),
    ];
    const options: CgCalculateOptions = {
      splitEvents: [{ date: d("2023-06-02T15:00:00Z"), symbol: "Z", ratioFrom: 1, ratioTo: 2 }],
    };
    // 100 pre-split shares become 200 post-split; selling all 200 draws the full
    // £1000 pool cost. Proceeds 200*8 = 1600 → gain 600.
    const sell = findSellEvent(runCgt(trades, options), "2023-07-01", "Z");
    expect(sell?.quantity).toBeCloseTo(200, 6);
    expect(sell?.costGBP).toBeCloseTo(1000, 6);
    expect(sell?.gainGBP).toBeCloseTo(600, 6);
  });
});

describe("result never aliases the internal HMRC config", () => {
  it("mutating a result's tax-year limits or rate period does not corrupt later calculations", () => {
    const trades: CgTradeInput[] = [
      makeTrade({ date: d("2020-05-01"), symbol: "X", type: "buy", quantity: 100, unitPrice: 10 }),
      makeTrade({ date: d("2021-01-01"), symbol: "X", type: "sell", quantity: 100, unitPrice: 50 }),
    ];
    const first = findTaxYear(runCgt(trades), "2020/21")!;
    // A careless consumer writes onto fields the engine baked from the HMRC config.
    first.limits.annualExemptAmount = 999999;
    first.periods[0].period.basicRate = 99;
    first.periods[0].period.from.setUTCFullYear(1999);

    // A fresh calculation must still see the canonical 2020/21 values, proving the
    // engine handed out copies rather than references into the shared config table.
    const second = findTaxYear(runCgt(trades), "2020/21")!;
    expect(second.limits.annualExemptAmount).toBe(12300);
    expect(second.periods[0].period.basicRate).toBe(10);
    expect(second.periods[0].period.higherRate).toBe(20);
    expect(second.periods[0].period.from).toEqual(d("2020-04-06"));
  });
});
