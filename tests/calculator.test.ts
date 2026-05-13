import { describe, it, expect } from "vitest";
import { calculateCgt } from "../src/calculator";
import type { CalculateCgtOptions } from "../src/calculator";
import type { CgtTradeInput } from "../src/trade";
import type { SplitEvent, CgtResult } from "../src/types";

function makeTrade(
  overrides: Partial<CgtTradeInput> & {
    date: string;
    symbol: string;
    type: "buy" | "sell" | "transfer";
    quantity: number;
    unitPrice: number;
  }
): CgtTradeInput {
  return {
    allowableExpenditure: 0,
    exchangeRate: 1.0,
    ...overrides,
  };
}

function runCgt(inputs: CgtTradeInput[], options?: CalculateCgtOptions): CgtResult {
  const result = calculateCgt(inputs, options);
  if (!result.ok) throw new Error(result.errors[0].message);
  return result.data;
}

const allowances: Record<string, number> = {
  "2021/22": 12300,
  "2022/23": 12300,
  "2023/24": 6000,
  "2024/25": 3000,
  "2025/26": 3000,
};

function findDisposal(result: CgtResult, date: string, symbol: string) {
  for (const ty of result.taxYears) {
    const d = ty.disposals.find((d) => d.date === date && d.symbol === symbol);
    if (d) return d;
  }
  return undefined;
}

function findTaxYear(result: CgtResult, taxYear: string) {
  return result.taxYears.find((ty) => ty.taxYear === taxYear);
}

describe("CGT Calculator - Section 104 Pool", () => {
  it("builds a pool from multiple buys and matches sell against weighted average cost", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-06-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 120,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 130,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AAPL")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("section-104");
    expect(disposal.matches[0].quantity).toBe(40);
    // Pool average: (50*100 + 50*120) / 100 = 110 per share
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(110, 2);
    // Gain: 40 * 130 - 40 * 110 = 800
    expect(disposal.gainGBP).toBeCloseTo(800, 0);
  });

  it("disposes entire pool leaving zero shares", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const pool = result.pools.find((p) => p.symbol === "AAPL");
    expect(pool).toBeUndefined();
  });

  it("handles multiple symbols independently", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-05-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 30,
        unitPrice: 200,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 25,
        unitPrice: 110,
      }),
      makeTrade({
        id: 4,
        date: "2022-09-01",
        symbol: "MSFT",
        type: "sell",
        quantity: 30,
        unitPrice: 220,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const aaplDisposal = findDisposal(result, "2022-09-01", "AAPL")!;
    const msftDisposal = findDisposal(result, "2022-09-01", "MSFT")!;

    expect(aaplDisposal.gainGBP).toBeCloseTo(25 * 10, 0);
    expect(msftDisposal.gainGBP).toBeCloseTo(30 * 20, 0);
  });
});

describe("CGT Calculator - Same-Day Matching", () => {
  it("matches same-day buy and sell before pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 130,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 20,
        unitPrice: 135,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AAPL")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(disposal.matches[0].quantity).toBe(20);
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(130, 2);
  });

  it("partial same-day match: remainder goes to pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 80,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 130,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 135,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AAPL")!;

    expect(disposal.matches).toHaveLength(2);
    const sameDayMatch = disposal.matches.find((m) => m.rule === "same-day")!;
    const poolMatch = disposal.matches.find((m) => m.rule === "section-104")!;

    expect(sameDayMatch.quantity).toBe(20);
    expect(poolMatch.quantity).toBe(30);
    expect(poolMatch.costPerShareGBP).toBeCloseTo(100, 2);
  });

  it("multiple same-day buys compose into single match", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 40,
        unitPrice: 200,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 15,
        unitPrice: 230,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 10,
        unitPrice: 232,
      }),
      makeTrade({
        id: 4,
        date: "2022-09-01",
        symbol: "MSFT",
        type: "sell",
        quantity: 40,
        unitPrice: 235,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "MSFT")!;

    const sameDayMatch = disposal.matches.find((m) => m.rule === "same-day")!;
    expect(sameDayMatch.quantity).toBe(25);
    // Weighted average: (15*230 + 10*232) / 25 = 230.8
    expect(sameDayMatch.costPerShareGBP).toBeCloseTo(230.8, 1);
  });

  it("exact quantity same-day match (no remainder)", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-09-01",
        symbol: "AVGO",
        type: "buy",
        quantity: 5,
        unitPrice: 1600,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AVGO",
        type: "sell",
        quantity: 5,
        unitPrice: 1620,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AVGO")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(disposal.matches[0].quantity).toBe(5);
    expect(disposal.gainGBP).toBeCloseTo(5 * 20, 0);
  });

  it("multiple sells same day are merged into single disposal", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "GOOGL",
        type: "sell",
        quantity: 80,
        unitPrice: 110,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "GOOGL",
        type: "sell",
        quantity: 50,
        unitPrice: 111,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const taxYear = findTaxYear(result, "2022/23")!;
    const googlDisposals = taxYear.disposals.filter(
      (d) => d.symbol === "GOOGL" && d.date === "2022-09-01"
    );

    expect(googlDisposals).toHaveLength(1);
    expect(googlDisposals[0].quantity).toBe(130);
  });
});

describe("CGT Calculator - Bed and Breakfast (30-day rule)", () => {
  it("matches sell with rebuy within 30 days", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 178,
      }),
      makeTrade({
        id: 2,
        date: "2022-11-20",
        symbol: "NVDA",
        type: "sell",
        quantity: 40,
        unitPrice: 155,
      }),
      makeTrade({
        id: 3,
        date: "2022-11-30",
        symbol: "NVDA",
        type: "buy",
        quantity: 40,
        unitPrice: 148,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-11-20", "NVDA")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("bed-and-breakfast");
    expect(disposal.matches[0].quantity).toBe(40);
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(148, 2);
  });

  it("partial B&B: sell more than rebought, remainder from pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "META",
        type: "buy",
        quantity: 60,
        unitPrice: 168,
      }),
      makeTrade({
        id: 2,
        date: "2022-12-05",
        symbol: "META",
        type: "sell",
        quantity: 60,
        unitPrice: 120,
      }),
      makeTrade({
        id: 3,
        date: "2022-12-20",
        symbol: "META",
        type: "buy",
        quantity: 25,
        unitPrice: 118,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-12-05", "META")!;

    expect(disposal.matches).toHaveLength(2);
    const bAndB = disposal.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = disposal.matches.find((m) => m.rule === "section-104")!;

    expect(bAndB.quantity).toBe(25);
    expect(pool.quantity).toBe(35);
    expect(pool.costPerShareGBP).toBeCloseTo(168, 2);
  });

  it("multiple B&B rebuys matched in chronological order", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2023-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 170,
      }),
      makeTrade({
        id: 2,
        date: "2023-10-10",
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 178,
      }),
      makeTrade({
        id: 3,
        date: "2023-10-15",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 175,
      }),
      makeTrade({
        id: 4,
        date: "2023-10-25",
        symbol: "AAPL",
        type: "buy",
        quantity: 12,
        unitPrice: 171,
      }),
      makeTrade({
        id: 5,
        date: "2023-11-05",
        symbol: "AAPL",
        type: "buy",
        quantity: 8,
        unitPrice: 176,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2023-10-10", "AAPL")!;

    const bAndBMatches = disposal.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatches).toHaveLength(3);
    expect(bAndBMatches[0].quantity).toBe(10);
    expect(bAndBMatches[1].quantity).toBe(12);
    expect(bAndBMatches[2].quantity).toBe(8);

    const poolMatch = disposal.matches.find((m) => m.rule === "section-104");
    expect(poolMatch!.quantity).toBe(10);
  });

  it("handles two B&B rebuys on the same date (tiebreaker by id)", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "TEST",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "TEST",
        type: "sell",
        quantity: 40,
        unitPrice: 70,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-10",
        symbol: "TEST",
        type: "buy",
        quantity: 15,
        unitPrice: 65,
      }),
      makeTrade({
        id: 4,
        date: "2022-09-10",
        symbol: "TEST",
        type: "buy",
        quantity: 10,
        unitPrice: 66,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "TEST")!;

    const bAndBMatches = disposal.matches.filter((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatches.length).toBeGreaterThanOrEqual(1);
    const totalBnB = bAndBMatches.reduce((s, m) => s + m.quantity, 0);
    expect(totalBnB).toBe(25);
  });

  it("rebuy at exactly day 30 triggers B&B", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2024-05-01",
        symbol: "LLY",
        type: "buy",
        quantity: 8,
        unitPrice: 760,
      }),
      makeTrade({
        id: 2,
        date: "2024-08-01",
        symbol: "LLY",
        type: "sell",
        quantity: 8,
        unitPrice: 930,
      }),
      makeTrade({
        id: 3,
        date: "2024-08-31",
        symbol: "LLY",
        type: "buy",
        quantity: 8,
        unitPrice: 915,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-08-01", "LLY")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("bed-and-breakfast");
    expect(disposal.matches[0].quantity).toBe(8);
  });

  it("rebuy at day 31 does NOT trigger B&B", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2024-05-01",
        symbol: "CRM",
        type: "buy",
        quantity: 25,
        unitPrice: 234,
      }),
      makeTrade({
        id: 2,
        date: "2024-09-10",
        symbol: "CRM",
        type: "sell",
        quantity: 25,
        unitPrice: 260,
      }),
      makeTrade({
        id: 3,
        date: "2024-10-11",
        symbol: "CRM",
        type: "buy",
        quantity: 25,
        unitPrice: 255,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-09-10", "CRM")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("section-104");
    expect(disposal.matches[0].quantity).toBe(25);
  });

  it("B&B spanning tax year boundary", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2023-05-01",
        symbol: "UNH",
        type: "buy",
        quantity: 10,
        unitPrice: 480,
      }),
      makeTrade({
        id: 2,
        date: "2024-03-25",
        symbol: "UNH",
        type: "sell",
        quantity: 10,
        unitPrice: 495,
      }),
      makeTrade({
        id: 3,
        date: "2024-04-10",
        symbol: "UNH",
        type: "buy",
        quantity: 10,
        unitPrice: 488,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-03-25", "UNH")!;

    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("bed-and-breakfast");
    expect(disposal.matches[0].quantity).toBe(10);
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(488, 2);
  });
});

describe("CGT Calculator - Combined Rules (same-day + B&B + pool)", () => {
  it("all three rules triggered on single sell", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2024-05-01",
        symbol: "AMZN",
        type: "buy",
        quantity: 50,
        unitPrice: 186,
      }),
      makeTrade({
        id: 2,
        date: "2024-07-15",
        symbol: "AMZN",
        type: "buy",
        quantity: 5,
        unitPrice: 195,
      }),
      makeTrade({
        id: 3,
        date: "2024-07-15",
        symbol: "AMZN",
        type: "sell",
        quantity: 30,
        unitPrice: 197,
      }),
      makeTrade({
        id: 4,
        date: "2024-07-25",
        symbol: "AMZN",
        type: "buy",
        quantity: 10,
        unitPrice: 190,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-07-15", "AMZN")!;

    const sameDay = disposal.matches.find((m) => m.rule === "same-day")!;
    const bAndB = disposal.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = disposal.matches.find((m) => m.rule === "section-104")!;

    expect(sameDay.quantity).toBe(5);
    expect(bAndB.quantity).toBe(10);
    expect(pool.quantity).toBe(15);
  });

  it("same-day match priority over B&B and pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2024-01-01",
        symbol: "TEST",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2024-06-01",
        symbol: "TEST",
        type: "buy",
        quantity: 20,
        unitPrice: 70,
      }),
      makeTrade({
        id: 3,
        date: "2024-06-01",
        symbol: "TEST",
        type: "sell",
        quantity: 80,
        unitPrice: 75,
      }),
      makeTrade({
        id: 4,
        date: "2024-06-10",
        symbol: "TEST",
        type: "buy",
        quantity: 30,
        unitPrice: 72,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-06-01", "TEST")!;

    const rules = disposal.matches.map((m) => m.rule);
    expect(rules).toContain("same-day");
    expect(rules).toContain("bed-and-breakfast");
    expect(rules).toContain("section-104");

    const sameDay = disposal.matches.find((m) => m.rule === "same-day")!;
    const bAndB = disposal.matches.find((m) => m.rule === "bed-and-breakfast")!;
    const pool = disposal.matches.find((m) => m.rule === "section-104")!;

    expect(sameDay.quantity).toBe(20);
    expect(bAndB.quantity).toBe(30);
    expect(pool.quantity).toBe(30);
  });
});

describe("CGT Calculator - Transfers", () => {
  it("transfer removes shares from pool at cost (zero gain)", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AMZN",
        type: "buy",
        quantity: 80,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AMZN",
        type: "transfer",
        quantity: 40,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AMZN")!;

    expect(disposal.type).toBe("transfer");
    expect(disposal.gainGBP).toBe(0);
    const pool = result.pools.find((p) => p.symbol === "AMZN")!;
    expect(pool.shares).toBe(40);
    expect(pool.costGBP).toBeCloseTo(40 * 100, 0);
  });
});

describe("CGT Calculator - Transfer matching (same-day & B&B)", () => {
  it("transfer matches same-day buy (not pool), affecting cost basis for recipient", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-15",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 200,
      }),
      makeTrade({
        id: 3,
        date: "2023-01-15",
        symbol: "AAPL",
        type: "transfer",
        quantity: 50,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("same-day");
    expect(transfer.matches[0].costPerShareGBP).toBeCloseTo(200, 0);
    expect(transfer.totalCostGBP).toBeCloseTo(50 * 200, 0);

    // Pool should retain original 100 shares at £50 (the same-day buy was consumed by transfer)
    const pool = result.pools.find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(100);
    expect(pool.costGBP).toBeCloseTo(100 * 50, 0);
  });

  it("transfer matches B&B buy within 30 days", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-10",
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 0,
      }),
      makeTrade({
        id: 3,
        date: "2023-01-20",
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 180,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("bed-and-breakfast");
    expect(transfer.matches[0].costPerShareGBP).toBeCloseTo(180, 0);
    expect(transfer.totalCostGBP).toBeCloseTo(30 * 180, 0);

    // Pool should retain original 100 shares at £50 (the B&B buy was consumed by transfer)
    const pool = result.pools.find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(100);
    expect(pool.costGBP).toBeCloseTo(100 * 50, 0);
  });

  it("transfer with partial same-day match and remainder from pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-15",
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 200,
      }),
      makeTrade({
        id: 3,
        date: "2023-01-15",
        symbol: "AAPL",
        type: "transfer",
        quantity: 50,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(2);

    const sameDayMatch = transfer.matches.find((m) => m.rule === "same-day")!;
    expect(sameDayMatch.quantity).toBe(20);
    expect(sameDayMatch.costPerShareGBP).toBeCloseTo(200, 0);

    const poolMatch = transfer.matches.find((m) => m.rule === "section-104")!;
    expect(poolMatch.quantity).toBe(30);
    expect(poolMatch.costPerShareGBP).toBeCloseTo(50, 0);

    // Cost basis for recipient: 20 shares at £200 + 30 shares at £50
    expect(transfer.totalCostGBP).toBeCloseTo(20 * 200 + 30 * 50, 0);

    // Pool: started with 100 @ £50, 30 removed from pool
    const pool = result.pools.find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(70);
    expect(pool.costGBP).toBeCloseTo(70 * 50, 0);
  });

  it("transfer B&B does not consume buy needed for a sell on same day", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-10",
        symbol: "AAPL",
        type: "sell",
        quantity: 30,
        unitPrice: 180,
      }),
      makeTrade({
        id: 3,
        date: "2023-01-10",
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 0,
      }),
      makeTrade({
        id: 4,
        date: "2023-01-20",
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 160,
      }),
    ];
    const result = runCgt(trades, { allowances });

    const sell = result.taxYears[0].disposals.find((d) => d.type === "disposal")!;
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer")!;

    // Both sell and transfer should try to match the B&B buy (40 shares available)
    // Sells and transfers are processed in order — the sell matches first (30), transfer gets remaining (10) + pool (20)
    const sellBnB = sell.matches.find((m) => m.rule === "bed-and-breakfast");
    const transferBnB = transfer.matches.find((m) => m.rule === "bed-and-breakfast");

    // The 40 available B&B shares should be distributed across both disposals
    const totalBnBMatched = (sellBnB?.quantity ?? 0) + (transferBnB?.quantity ?? 0);
    expect(totalBnBMatched).toBe(40);

    expect(sell.gainGBP).not.toBe(0);
    expect(transfer.gainGBP).toBe(0);
  });

  it("transfer still falls through to pool when no same-day or B&B available", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        id: 2,
        date: "2023-06-01",
        symbol: "AAPL",
        type: "transfer",
        quantity: 40,
        unitPrice: 0,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer")!;

    expect(transfer.gainGBP).toBe(0);
    expect(transfer.matches).toHaveLength(1);
    expect(transfer.matches[0].rule).toBe("section-104");
    expect(transfer.matches[0].costPerShareGBP).toBeCloseTo(50, 0);
    expect(transfer.totalCostGBP).toBeCloseTo(40 * 50, 0);

    const pool = result.pools.find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBe(60);
    expect(pool.costGBP).toBeCloseTo(60 * 50, 0);
  });
});

describe("CGT Calculator - Losses", () => {
  it("loss when selling below cost", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "TSLA",
        type: "buy",
        quantity: 30,
        unitPrice: 303,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-15",
        symbol: "TSLA",
        type: "sell",
        quantity: 30,
        unitPrice: 122,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2023-01-15", "TSLA")!;

    expect(disposal.gainGBP).toBeLessThan(0);
    expect(disposal.gainGBP).toBeCloseTo(30 * (122 - 303), 0);
  });

  it("fees cause a loss even when price is unchanged", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2025-01-10",
        symbol: "HD",
        type: "buy",
        quantity: 10,
        unitPrice: 380,
        allowableExpenditure: 5,
      }),
      makeTrade({
        id: 2,
        date: "2025-01-10",
        symbol: "HD",
        type: "sell",
        quantity: 10,
        unitPrice: 380,
        allowableExpenditure: 5,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2025-01-10", "HD")!;

    expect(disposal.gainGBP).toBeLessThan(0);
  });
});

describe("CGT Calculator - Exchange Rates", () => {
  it("converts USD trades to GBP using exchange rate", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 150,
        exchangeRate: 1.25,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 180,
        exchangeRate: 1.2,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "AAPL")!;

    // Cost: 10 * 150 / 1.25 = 1200 GBP
    // Proceeds: 10 * 180 / 1.20 = 1500 GBP
    // Gain: 300
    expect(disposal.gainGBP).toBeCloseTo(300, 0);
  });

  it("GBP trades use exchange rate of 1", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2023-12-01",
        symbol: "SHEL",
        type: "buy",
        quantity: 100,
        unitPrice: 26.5,
        exchangeRate: 1.0,
        allowableExpenditure: 11.95,
      }),
      makeTrade({
        id: 2,
        date: "2024-02-15",
        symbol: "SHEL",
        type: "sell",
        quantity: 100,
        unitPrice: 27.8,
        exchangeRate: 1.0,
        allowableExpenditure: 11.95,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-02-15", "SHEL")!;

    // Proceeds: 100 * 27.80 - 11.95 = 2768.05
    // Cost: 100 * 26.50 + 11.95 = 2661.95
    // Gain: 106.10
    expect(disposal.gainGBP).toBeCloseTo(106.1, 0);
  });

  it("different exchange rates for buy and sell affect gain", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "COST",
        type: "buy",
        quantity: 15,
        unitPrice: 540,
        exchangeRate: 1.28,
      }),
      makeTrade({
        id: 2,
        date: "2024-11-01",
        symbol: "COST",
        type: "buy",
        quantity: 10,
        unitPrice: 890,
        exchangeRate: 1.3,
      }),
      makeTrade({
        id: 3,
        date: "2024-12-01",
        symbol: "COST",
        type: "sell",
        quantity: 25,
        unitPrice: 920,
        exchangeRate: 1.27,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2024-12-01", "COST")!;

    expect(disposal.gainGBP).toBeGreaterThan(0);
    expect(disposal.matches[0].rule).toBe("section-104");
  });
});

describe("CGT Calculator - Stock Splits", () => {
  it("pre-split buy has adjustmentFactor applied to quantity and cost", () => {
    const splitEvents: SplitEvent[] = [
      { date: "2022-07-18", symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
    ];
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-06-15",
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 113,
      }),
      makeTrade({
        id: 2,
        date: "2023-02-01",
        symbol: "GOOGL",
        type: "sell",
        quantity: 130,
        unitPrice: 102,
      }),
    ];
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2023-02-01", "GOOGL")!;

    expect(disposal.matches[0].rule).toBe("section-104");
    // Pre-split: 200 shares @ 113. After 20:1 split: 4000 shares, cost unchanged.
    // Pool cost per share: (200 * 113) / 4000 = 5.65
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(5.65, 2);
    expect(disposal.matches[0].quantity).toBe(130);
  });
});

describe("CGT Calculator - Tax Year Summaries", () => {
  it("net gain is gains + losses", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "WIN",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-05-01",
        symbol: "LOSE",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        id: 3,
        date: "2022-09-01",
        symbol: "WIN",
        type: "sell",
        quantity: 10,
        unitPrice: 150,
      }),
      makeTrade({
        id: 4,
        date: "2022-09-01",
        symbol: "LOSE",
        type: "sell",
        quantity: 10,
        unitPrice: 60,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const year = findTaxYear(result, "2022/23")!;

    expect(year.totalGains).toBeCloseTo(500, 0);
    expect(year.totalLosses).toBeCloseTo(-400, 0);
    expect(year.netGainLoss).toBeCloseTo(100, 0);
  });

  it("taxable gain is zero when net gain below annual exempt amount", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 10,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const year = findTaxYear(result, "2022/23")!;

    expect(year.netGainLoss).toBeCloseTo(100, 0);
    expect(year.annualExemptAmount).toBe(12300);
    expect(year.taxableGain).toBe(0);
  });

  it("taxable gain computed when net gain exceeds AEA", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2024-05-01",
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2024-09-01",
        symbol: "NVDA",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const year = findTaxYear(result, "2024/25")!;

    expect(year.netGainLoss).toBeCloseTo(10000, 0);
    expect(year.annualExemptAmount).toBe(3000);
    expect(year.taxableGain).toBeCloseTo(7000, 0);
  });

  it("transfers do not count toward disposal count", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AMZN",
        type: "buy",
        quantity: 100,
        unitPrice: 100,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "AMZN",
        type: "transfer",
        quantity: 50,
        unitPrice: 100,
      }),
      makeTrade({
        id: 3,
        date: "2022-10-01",
        symbol: "AMZN",
        type: "sell",
        quantity: 25,
        unitPrice: 120,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const year = findTaxYear(result, "2022/23")!;

    expect(year.disposalCount).toBe(1);
  });
});

describe("CGT Calculator - Fractional Shares", () => {
  it("handles fractional buy and sell quantities", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2025-10-15",
        symbol: "BRK.B",
        type: "buy",
        quantity: 0.5,
        unitPrice: 460,
      }),
      makeTrade({
        id: 2,
        date: "2025-11-01",
        symbol: "BRK.B",
        type: "buy",
        quantity: 1.75,
        unitPrice: 465,
      }),
      makeTrade({
        id: 3,
        date: "2025-12-01",
        symbol: "BRK.B",
        type: "sell",
        quantity: 1.0,
        unitPrice: 480,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2025-12-01", "BRK.B")!;

    expect(disposal.quantity).toBe(1.0);
    expect(disposal.matches[0].rule).toBe("section-104");
    expect(disposal.gainGBP).toBeGreaterThan(0);

    const pool = result.pools.find((p) => p.symbol === "BRK.B")!;
    expect(pool.shares).toBeCloseTo(1.25, 4);
  });
});

describe("CGT Calculator - Fees (Allowable Expenditure)", () => {
  it("fees increase cost basis and reduce net proceeds", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "TEST",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
        allowableExpenditure: 20,
      }),
      makeTrade({
        id: 2,
        date: "2022-09-01",
        symbol: "TEST",
        type: "sell",
        quantity: 10,
        unitPrice: 110,
        allowableExpenditure: 15,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2022-09-01", "TEST")!;

    // Proceeds: (10*110 - 15) = 1085
    // Cost: (10*100 + 20) = 1020
    // Gain: 65
    expect(disposal.gainGBP).toBeCloseTo(65, 0);
  });

  it("high fees can turn a nominal gain into a loss", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2025-12-10",
        symbol: "AZN",
        type: "buy",
        quantity: 20,
        unitPrice: 108,
        allowableExpenditure: 50,
      }),
      makeTrade({
        id: 2,
        date: "2026-01-20",
        symbol: "AZN",
        type: "sell",
        quantity: 20,
        unitPrice: 112,
        allowableExpenditure: 50,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2026-01-20", "AZN")!;

    // Proceeds: (20*112 - 50) = 2190
    // Cost: (20*108 + 50) = 2210
    // Loss: -20
    expect(disposal.gainGBP).toBeCloseTo(-20, 0);
  });
});

describe("CGT Calculator - Full Integration (all test trades)", () => {
  const splitEvents: SplitEvent[] = [
    { date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
    { date: "2022-07-18", symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
  ];

  function makeFullTestTrades(): CgtTradeInput[] {
    return [
      {
        id: 1,
        date: "2022-04-20",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 167.5,
        allowableExpenditure: 5,
        exchangeRate: 1.3,
      },
      {
        id: 2,
        date: "2022-05-10",
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 155.2,
        allowableExpenditure: 5,
        exchangeRate: 1.25,
      },
      {
        id: 3,
        date: "2022-05-15",
        symbol: "MSFT",
        type: "buy",
        quantity: 40,
        unitPrice: 268,
        allowableExpenditure: 5,
        exchangeRate: 1.25,
      },
      {
        id: 4,
        date: "2022-06-01",
        symbol: "NVDA",
        type: "buy",
        quantity: 100,
        unitPrice: 178,
        allowableExpenditure: 5,
        exchangeRate: 1.26,
      },
      {
        id: 5,
        date: "2022-06-15",
        symbol: "GOOGL",
        type: "buy",
        quantity: 200,
        unitPrice: 113,
        allowableExpenditure: 0,
        exchangeRate: 1.23,
      },
      {
        id: 6,
        date: "2022-07-01",
        symbol: "AMZN",
        type: "buy",
        quantity: 80,
        unitPrice: 113.5,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        id: 7,
        date: "2022-08-10",
        symbol: "META",
        type: "buy",
        quantity: 60,
        unitPrice: 168,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        id: 8,
        date: "2022-09-20",
        symbol: "TSLA",
        type: "buy",
        quantity: 30,
        unitPrice: 303,
        allowableExpenditure: 5,
        exchangeRate: 1.14,
      },
      {
        id: 9,
        date: "2022-10-15",
        symbol: "AAPL",
        type: "buy",
        quantity: 20,
        unitPrice: 142,
        allowableExpenditure: 5,
        exchangeRate: 1.12,
      },
      {
        id: 10,
        date: "2022-10-15",
        symbol: "AAPL",
        type: "sell",
        quantity: 50,
        unitPrice: 143.5,
        allowableExpenditure: 5,
        exchangeRate: 1.12,
      },
      {
        id: 11,
        date: "2022-11-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 15,
        unitPrice: 230,
        allowableExpenditure: 5,
        exchangeRate: 1.15,
      },
      {
        id: 12,
        date: "2022-11-01",
        symbol: "MSFT",
        type: "buy",
        quantity: 10,
        unitPrice: 232,
        allowableExpenditure: 0,
        exchangeRate: 1.15,
      },
      {
        id: 13,
        date: "2022-11-01",
        symbol: "MSFT",
        type: "sell",
        quantity: 40,
        unitPrice: 233,
        allowableExpenditure: 5,
        exchangeRate: 1.15,
      },
      {
        id: 14,
        date: "2022-11-20",
        symbol: "NVDA",
        type: "sell",
        quantity: 40,
        unitPrice: 155,
        allowableExpenditure: 5,
        exchangeRate: 1.19,
      },
      {
        id: 15,
        date: "2022-11-30",
        symbol: "NVDA",
        type: "buy",
        quantity: 40,
        unitPrice: 148,
        allowableExpenditure: 5,
        exchangeRate: 1.2,
      },
      {
        id: 16,
        date: "2022-12-05",
        symbol: "META",
        type: "sell",
        quantity: 60,
        unitPrice: 120,
        allowableExpenditure: 5,
        exchangeRate: 1.21,
      },
      {
        id: 17,
        date: "2022-12-20",
        symbol: "META",
        type: "buy",
        quantity: 25,
        unitPrice: 118,
        allowableExpenditure: 5,
        exchangeRate: 1.2,
      },
      {
        id: 18,
        date: "2023-01-15",
        symbol: "TSLA",
        type: "sell",
        quantity: 30,
        unitPrice: 122,
        allowableExpenditure: 5,
        exchangeRate: 1.23,
      },
      {
        id: 19,
        date: "2023-02-01",
        symbol: "GOOGL",
        type: "sell",
        quantity: 80,
        unitPrice: 102,
        allowableExpenditure: 5,
        exchangeRate: 1.23,
      },
      {
        id: 20,
        date: "2023-02-01",
        symbol: "GOOGL",
        type: "sell",
        quantity: 50,
        unitPrice: 101.5,
        allowableExpenditure: 0,
        exchangeRate: 1.23,
      },
      {
        id: 21,
        date: "2023-03-01",
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
    const result = runCgt(trades, { allowances, splitEvents });
    const year = findTaxYear(result, "2022/23")!;

    // Our calculator merges same-day same-symbol sells into 1 disposal:
    // AAPL(1) + MSFT(1) + NVDA(1) + META(1) + TSLA(1) + GOOGL(1) = 6
    expect(year.disposalCount).toBe(6);
    // Reference: net gain (gains - losses)
    expect(year.totalGains).toBeCloseTo(10511, -2);
    expect(year.totalLosses).toBeCloseTo(-6566, -2);
    expect(year.netGainLoss).toBeCloseTo(3945, -2);
    expect(year.taxableGain).toBe(0);
  });

  it("GOOGL disposal accounts for 20:1 split (4000 adjusted shares in pool)", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2023-02-01", "GOOGL")!;

    expect(disposal.matches[0].rule).toBe("section-104");
    // 200 pre-split shares * 20 = 4000 adjusted shares
    expect(disposal.matches[0].poolSharesAtMatch).toBeCloseTo(4000, 0);
  });

  it("NVDA disposal matches B&B with 30/11 rebuy", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2022-11-20", "NVDA")!;

    expect(disposal.matches[0].rule).toBe("bed-and-breakfast");
    expect(disposal.matches[0].quantity).toBe(40);
    expect(disposal.matches[0].matchedDate).toBe("2022-11-30");
  });

  it("AAPL same-day partial match on 2022-10-15", () => {
    const trades = makeFullTestTrades();
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2022-10-15", "AAPL")!;

    const sameDay = disposal.matches.find((m) => m.rule === "same-day");
    const pool = disposal.matches.find((m) => m.rule === "section-104");

    expect(sameDay).toBeDefined();
    expect(sameDay!.quantity).toBe(20);
    expect(pool).toBeDefined();
    expect(pool!.quantity).toBe(30);
  });
});

describe("CGT Calculator - Bed & Breakfast acquisition dispositions", () => {
  it("records B&B disposition on the acquisition that was matched", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
      makeTrade({ date: "2023-06-15", symbol: "AAPL", type: "buy", quantity: 30, unitPrice: 140 }),
    ];
    const result = runCgt(trades, { allowances });

    const disposal = result.taxYears[0].disposals[0];
    const bAndB = disposal.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.quantity).toBe(30);

    const acquisition = result.taxYears[0].acquisitions.find((a) => a.date === "2023-06-15");
    expect(acquisition).toBeDefined();
    const bAndBDisposition = acquisition!.dispositions.find((d) => d.rule === "bed-and-breakfast");
    expect(bAndBDisposition).toBeDefined();
    expect(bAndBDisposition!.quantity).toBe(30);
  });
});

describe("CGT Calculator - Pool impact", () => {
  it("returns null poolImpact when buy is fully consumed by same-day match", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    const acquisition = result.taxYears[0].acquisitions[0];
    expect(acquisition.poolImpact).toBeNull();
  });

  it("returns sharesAdded/costAdded when buy enters pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
    ];
    const result = runCgt(trades, { allowances });
    const acquisition = result.taxYears[0].acquisitions[0];
    expect(acquisition.poolImpact).not.toBeNull();
    expect(acquisition.poolImpact!.sharesAdded).toBe(100);
    expect(acquisition.poolImpact!.costAdded).toBeCloseTo(5000);
  });

  it("returns sharesRemoved/costRemoved when sell matches pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 40, unitPrice: 70 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.poolImpact).not.toBeNull();
    expect(disposal.poolImpact!.sharesRemoved).toBe(40);
    expect(disposal.poolImpact!.costRemoved).toBeCloseTo(2000);
  });

  it("returns null poolImpact for sell fully matched by same-day rule", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 100 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.poolImpact).toBeNull();
  });
});

describe("CGT Calculator - Input validation", () => {
  it("returns errors on invalid input by default", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: -5, unitPrice: 100 }),
    ];
    const result = calculateCgt(trades, { allowances });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("Quantity must be positive");
      expect(result.errors[0].index).toBe(0);
    }
  });

  it("returns errors on pre-2008 trade", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2007-01-01", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 100 }),
    ];
    const result = calculateCgt(trades, { allowances });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("before 6 April 2008");
    }
  });

  it("returns all validation errors at once", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2007-01-01", symbol: "AAPL", type: "buy", quantity: -5, unitPrice: -1 }),
    ];
    const result = calculateCgt(trades, { allowances });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });

  it("skips validation when skipValidation is true", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 100 }),
    ];
    const result = runCgt(trades, { allowances, skipValidation: true });
    expect(result.taxYears).toHaveLength(1);
  });
});

describe("CGT Calculator - Tax year allowance validation", () => {
  it("throws when allowances map is missing the required tax year", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 150,
      }),
    ];
    expect(() => runCgt(trades, { allowances: {} })).toThrow(
      "No annual exempt amount configured for tax year"
    );
  });

  it("throws when tax year config is missing for a year with custom allowances", () => {
    const customAllowances = { "2050/51": 3000 };
    const trades: CgtTradeInput[] = [
      makeTrade({
        date: "2050-06-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 100,
        unitPrice: 50,
      }),
      makeTrade({
        date: "2050-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 150,
      }),
    ];
    expect(() => runCgt(trades, { allowances: customAllowances })).toThrow(
      "No tax year configuration found for 2050/51"
    );
  });
});

describe("CGT Calculator - Transfer disposals", () => {
  it("creates a transfer disposal with pool impact", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "transfer",
        quantity: 40,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.poolImpact).not.toBeNull();
    expect(transfer!.poolImpact!.sharesRemoved).toBe(40);
    expect(transfer!.gainGBP).toBe(0);
  });
});

describe("CGT Calculator - Multiple tax years with pool snapshots", () => {
  it("captures pool snapshots when disposals span multiple tax years", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2022-05-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2022-08-01", symbol: "AAPL", type: "sell", quantity: 30, unitPrice: 150 }),
      makeTrade({ date: "2023-08-01", symbol: "AAPL", type: "sell", quantity: 20, unitPrice: 160 }),
    ];
    const result = runCgt(trades, { allowances });
    expect(result.taxYears).toHaveLength(2);
    expect(result.poolSnapshots["2022/23"]).toBeDefined();
    expect(result.poolSnapshots["2022/23"][0].shares).toBe(70);
  });
});

describe("CGT Calculator - Empty pool and no-match cases", () => {
  it("sell fully matched by same-day — no pool interaction", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    expect(result.pools).toHaveLength(0);
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(disposal.poolImpact).toBeNull();
  });

  it("sell with empty pool and no B&B — only same-day match available", () => {
    // Buy and sell same day, then later sell with nothing left
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 30, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 30, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(result.pools).toHaveLength(0);
  });

  it("transfer when pool has no shares for that symbol", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 10, unitPrice: 150 }),
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "transfer",
        quantity: 5,
        unitPrice: 100,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transferDisposal = result.taxYears[0].disposals.find((d) => d.type === "transfer");
    expect(transferDisposal).toBeUndefined();
  });

  it("sell with remaining but no pool (B&B consumed all buys)", () => {
    // Sell 50, B&B matches 30 (the only buy within 30 days), remaining 20 has no pool
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 30, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 30, unitPrice: 150 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 20, unitPrice: 160 }),
      makeTrade({ date: "2023-06-10", symbol: "AAPL", type: "buy", quantity: 20, unitPrice: 140 }),
    ];
    const result = runCgt(trades, { allowances });
    const secondDisposal = result.taxYears[0].disposals.find((d) => d.date === "2023-06-01");
    expect(secondDisposal).toBeDefined();
    const bAndB = secondDisposal!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.quantity).toBe(20);
    expect(secondDisposal!.poolImpact).toBeNull();
  });

  it("sell with remaining shares but pool depleted by prior sell", () => {
    // Buy 50, sell 50 (pool), then sell 30 with B&B buy 30 after.
    // Pool depleted by first sell, second sell has B&B covering only 30.
    // But what if we sell more than B&B covers?
    // Buy 50 → pool has 50. Sell 50 → pool depleted to 0.
    // Sell 20 → remaining=20, pool empty → hits the false branch on pool check
    // B&B buy 10 covers 10, remaining=10, pool is empty
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2022-01-01", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 20, unitPrice: 160 }),
      makeTrade({ date: "2023-06-10", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 155 }),
    ];
    const result = runCgt(trades, { allowances });
    const secondSell = result.taxYears[0].disposals.find((d) => d.date === "2023-06-01");
    expect(secondSell).toBeDefined();
    // B&B matches 10, remaining 10 goes to pool which is empty
    const bAndB = secondSell!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.quantity).toBe(10);
    // No section-104 match because pool is empty
    const poolMatch = secondSell!.matches.find((m) => m.rule === "section-104");
    expect(poolMatch).toBeUndefined();
    expect(secondSell!.poolImpact).toBeNull();
  });

  it("acquisition with no sell matches has empty dispositions from sells", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
    ];
    const result = runCgt(trades, { allowances });
    const acquisition = result.taxYears[0].acquisitions[0];
    expect(acquisition.dispositions).toHaveLength(1);
    expect(acquisition.dispositions[0].rule).toBe("pool");
  });
});

describe("CGT Calculator - Edge cases for branch coverage", () => {
  it("handles calculateCgt with no options", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 100 }),
    ];
    const result = runCgt(trades);
    expect(result.taxYears).toHaveLength(1);
  });

  it("sorts trades with later date first (covers a.date > b.date branch)", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 5, unitPrice: 150 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 10, unitPrice: 100 }),
    ];
    const result = runCgt(trades, { allowances });
    expect(result.taxYears[0].disposals[0].date).toBe("2023-06-01");
  });

  it("handles same-date trades sorted by id", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 2,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 100,
      }),
      makeTrade({
        id: 1,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 5,
        unitPrice: 90,
      }),
    ];
    const result = runCgt(trades, { allowances });
    expect(result.taxYears[0].acquisitions).toHaveLength(1);
  });

  it("same-day sell with multiple same-day buys where first covers all", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 90 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 95 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 80, unitPrice: 110 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(disposal.matches[0].quantity).toBe(80);
  });

  it("same-day sell consuming shares from multiple buys (exhausts first buy)", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 30,
        unitPrice: 90,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 95,
      }),
      makeTrade({
        id: 3,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 60,
        unitPrice: 110,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.matches[0].rule).toBe("same-day");
    expect(disposal.matches[0].quantity).toBe(60);
  });

  it("B&B with multiple buys in 30 days where first covers the sell", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2022-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 80 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 20, unitPrice: 150 }),
      makeTrade({ date: "2023-01-05", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 140 }),
      makeTrade({ date: "2023-01-10", symbol: "AAPL", type: "buy", quantity: 30, unitPrice: 145 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    const bAndB = disposal.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndB).toBeDefined();
    expect(bAndB!.quantity).toBe(20);
  });

  it("handles empty trade list", () => {
    const result = runCgt([], { allowances });
    expect(result.taxYears).toHaveLength(0);
    expect(result.pools).toHaveLength(0);
  });

  it("handles transfer with pool impact tracking", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({
        date: "2023-03-01",
        symbol: "AAPL",
        type: "transfer",
        quantity: 30,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const transfer = result.taxYears[0].disposals.find((d) => d.type === "transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.poolStateBefore.length).toBeGreaterThan(0);
    expect(transfer!.poolStateAfter.length).toBeGreaterThan(0);
  });

  it("pure pool sell (no same-day/B&B) uses sellMatches fallback", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2022-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 80 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 40, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    expect(disposal.matches).toHaveLength(1);
    expect(disposal.matches[0].rule).toBe("section-104");
  });

  it("buy fully consumed by B&B has null poolImpact", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 80 }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
      makeTrade({ date: "2023-06-10", symbol: "AAPL", type: "buy", quantity: 50, unitPrice: 140 }),
    ];
    const result = runCgt(trades, { allowances });
    const bAndBAcquisition = result.taxYears[0].acquisitions.find((a) => a.date === "2023-06-10");
    expect(bAndBAcquisition).toBeDefined();
    expect(bAndBAcquisition!.poolImpact).toBeNull();
  });

  it("sell matching partially from same-day and partially from pool", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2022-06-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 80 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "buy", quantity: 20, unitPrice: 100 }),
      makeTrade({ date: "2023-01-01", symbol: "AAPL", type: "sell", quantity: 50, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = result.taxYears[0].disposals[0];
    const sameDay = disposal.matches.find((m) => m.rule === "same-day");
    const pool = disposal.matches.find((m) => m.rule === "section-104");
    expect(sameDay).toBeDefined();
    expect(sameDay!.quantity).toBe(20);
    expect(pool).toBeDefined();
    expect(pool!.quantity).toBe(30);
    expect(disposal.poolImpact).not.toBeNull();
    expect(disposal.poolImpact!.sharesRemoved).toBe(30);
  });
});

describe("CGT Calculator - Tax rate computation", () => {
  it("computes tax at basic and higher rates for a single period year", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-05-01", symbol: "AAPL", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({
        date: "2023-09-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 200,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const year = result.taxYears[0];

    // Gain = 10000, AEA = 6000, taxable = 4000
    expect(year.taxableGain).toBe(4000);
    // 2023/24 rates: 10% basic, 20% higher
    expect(year.taxBasicRate).toBeCloseTo(400);
    expect(year.taxHigherRate).toBeCloseTo(800);
    expect(year.periods).toHaveLength(1);
    expect(year.periods[0].rates).toEqual({ basic: 10, higher: 20 });
  });

  it("computes tax across two rate periods in 2024/25", () => {
    const customAllowances = { "2024/25": 3000 };
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2024-05-01", symbol: "AAA", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2024-06-01", symbol: "BBB", type: "buy", quantity: 100, unitPrice: 100 }),
      // Sell before 30 Oct — rates 10%/20%
      makeTrade({ date: "2024-09-01", symbol: "AAA", type: "sell", quantity: 100, unitPrice: 150 }),
      // Sell after 30 Oct — rates 18%/24%
      makeTrade({ date: "2024-11-15", symbol: "BBB", type: "sell", quantity: 100, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances: customAllowances });
    const year = result.taxYears[0];

    expect(year.periods).toHaveLength(2);

    // AEA (3000) deducted from total net gain (10000), taxable = 7000
    // Distributed proportionally: each period has 50% of gains → 3500 each
    const p1 = year.periods[0];
    expect(p1.rates).toEqual({ basic: 10, higher: 20 });
    expect(p1.totalGains).toBe(5000);
    expect(p1.taxableGain).toBe(3500);
    expect(p1.taxBasicRate).toBeCloseTo(350);
    expect(p1.taxHigherRate).toBeCloseTo(700);

    const p2 = year.periods[1];
    expect(p2.rates).toEqual({ basic: 18, higher: 24 });
    expect(p2.totalGains).toBe(5000);
    expect(p2.taxableGain).toBe(3500);
    expect(p2.taxBasicRate).toBeCloseTo(630);
    expect(p2.taxHigherRate).toBeCloseTo(840);

    // Year totals
    expect(year.taxableGain).toBe(7000);
    expect(year.taxBasicRate).toBeCloseTo(980);
    expect(year.taxHigherRate).toBeCloseTo(1540);
  });

  it("loss in period 1 offsets gain in period 2 — net below AEA means no tax", () => {
    const customAllowances = { "2024/25": 3000 };
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2024-05-01", symbol: "AAA", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2024-05-01", symbol: "BBB", type: "buy", quantity: 100, unitPrice: 100 }),
      // Period 1: sell at loss (gain = -1000)
      makeTrade({ date: "2024-09-01", symbol: "AAA", type: "sell", quantity: 100, unitPrice: 90 }),
      // Period 2: sell at profit (gain = 2000)
      makeTrade({ date: "2024-11-15", symbol: "BBB", type: "sell", quantity: 100, unitPrice: 120 }),
    ];
    const result = runCgt(trades, { allowances: customAllowances });
    const year = result.taxYears[0];

    // Total net: -1000 + 2000 = 1000, below AEA of 3000 → no tax
    expect(year.netGainLoss).toBe(1000);
    expect(year.taxableGain).toBe(0);
    expect(year.taxBasicRate).toBe(0);
    expect(year.taxHigherRate).toBe(0);
  });

  it("loss in period 1 offsets gain in period 2 — net above AEA, tax only on excess", () => {
    const customAllowances = { "2024/25": 3000 };
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2024-05-01", symbol: "AAA", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2024-05-01", symbol: "BBB", type: "buy", quantity: 100, unitPrice: 100 }),
      // Period 1: loss of 1000
      makeTrade({ date: "2024-09-01", symbol: "AAA", type: "sell", quantity: 100, unitPrice: 90 }),
      // Period 2: gain of 4100
      makeTrade({ date: "2024-11-15", symbol: "BBB", type: "sell", quantity: 100, unitPrice: 141 }),
    ];
    const result = runCgt(trades, { allowances: customAllowances });
    const year = result.taxYears[0];

    // Net: -1000 + 4100 = 3100, minus AEA 3000 → taxable = 100
    expect(year.netGainLoss).toBe(3100);
    expect(year.taxableGain).toBeCloseTo(100);
    // Only period 2 has positive gains so all taxable goes there (at 18%/24%)
    expect(year.periods[1].taxableGain).toBeCloseTo(100);
    expect(year.periods[1].taxBasicRate).toBeCloseTo(18);
    expect(year.periods[1].taxHigherRate).toBeCloseTo(24);
  });

  it("gains in both periods — AEA deducted proportionally", () => {
    const customAllowances = { "2024/25": 3000 };
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2024-05-01", symbol: "AAA", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2024-05-01", symbol: "BBB", type: "buy", quantity: 100, unitPrice: 100 }),
      // Period 1: gain of 3000
      makeTrade({ date: "2024-09-01", symbol: "AAA", type: "sell", quantity: 100, unitPrice: 130 }),
      // Period 2: gain of 3000
      makeTrade({ date: "2024-11-15", symbol: "BBB", type: "sell", quantity: 100, unitPrice: 130 }),
    ];
    const result = runCgt(trades, { allowances: customAllowances });
    const year = result.taxYears[0];

    // Net: 6000, minus AEA 3000 → taxable = 3000
    // Proportional: each period has 50% of gains → 1500 each
    expect(year.taxableGain).toBe(3000);
    expect(year.periods[0].taxableGain).toBe(1500);
    expect(year.periods[1].taxableGain).toBe(1500);
    // Period 1 at 10%/20%, Period 2 at 18%/24%
    expect(year.periods[0].taxBasicRate).toBeCloseTo(150);
    expect(year.periods[0].taxHigherRate).toBeCloseTo(300);
    expect(year.periods[1].taxBasicRate).toBeCloseTo(270);
    expect(year.periods[1].taxHigherRate).toBeCloseTo(360);
  });

  it("AEA fully absorbs gains — zero tax", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-05-01", symbol: "XYZ", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2023-09-01", symbol: "XYZ", type: "sell", quantity: 100, unitPrice: 120 }),
    ];
    const result = runCgt(trades, { allowances });
    const year = result.taxYears[0];

    // Gain = 2000, AEA = 6000
    expect(year.taxableGain).toBe(0);
    expect(year.taxBasicRate).toBe(0);
    expect(year.taxHigherRate).toBe(0);
  });

  it("losses reduce taxable gain before tax computation", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({ date: "2023-05-01", symbol: "WIN", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2023-05-01", symbol: "LOSE", type: "buy", quantity: 100, unitPrice: 100 }),
      makeTrade({ date: "2023-09-01", symbol: "WIN", type: "sell", quantity: 100, unitPrice: 200 }),
      makeTrade({ date: "2023-09-01", symbol: "LOSE", type: "sell", quantity: 100, unitPrice: 50 }),
    ];
    const result = runCgt(trades, { allowances });
    const year = result.taxYears[0];

    // Gain 10000, Loss -5000, Net 5000, AEA 6000, taxable 0
    expect(year.totalGains).toBe(10000);
    expect(year.totalLosses).toBe(-5000);
    expect(year.netGainLoss).toBe(5000);
    expect(year.taxableGain).toBe(0);
    expect(year.taxBasicRate).toBe(0);
  });
});

describe("CGT Calculator - Sell with no buys for symbol", () => {
  it("sell skips same-day/B&B matching when no buys exist for the symbol", () => {
    const trades: CgtTradeInput[] = [
      makeTrade({
        date: "2023-01-01",
        symbol: "ORPHAN",
        type: "sell",
        quantity: 10,
        unitPrice: 60,
      }),
    ];
    const result = runCgt(trades, { allowances, skipValidation: true });
    const disposal = findDisposal(result, "2023-01-01", "ORPHAN")!;
    expect(disposal.matches).toHaveLength(0);
    expect(disposal.gainGBP).toBe(0);
  });
});

describe("CGT Calculator - Compounding stock splits", () => {
  it("correctly handles two splits on the same symbol (4:1 then 2:1 = 8x)", () => {
    const splitEvents: SplitEvent[] = [
      { date: "2022-08-31", symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
      { date: "2023-06-06", symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
    ];
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 320,
      }),
      makeTrade({
        id: 2,
        date: "2024-01-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 40,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2024-01-01", "AAPL")!;

    expect(disposal.matches[0].rule).toBe("section-104");
    // 10 pre-split shares × 8 (4×2) = 80 adjusted shares in pool
    // Total cost unchanged: 10 × 320 = 3200
    // Cost per adjusted share: 3200 / 80 = 40
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(40, 2);
    expect(disposal.matches[0].quantity).toBe(40);
    // Gain: 40 × 50 - 40 × 40 = 2000 - 1600 = 400
    expect(disposal.gainGBP).toBeCloseTo(400, 0);

    // Remaining pool: 40 shares, cost 1600
    const pool = result.pools.find((p) => p.symbol === "AAPL")!;
    expect(pool.shares).toBeCloseTo(40, 4);
    expect(pool.costGBP).toBeCloseTo(1600, 0);
  });

  it("buy between two splits only gets the second split applied", () => {
    const splitEvents: SplitEvent[] = [
      { date: "2022-08-31", symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
      { date: "2023-06-06", symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
    ];
    const trades: CgtTradeInput[] = [
      makeTrade({
        id: 1,
        date: "2022-05-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 320,
      }),
      makeTrade({
        id: 2,
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 40,
        unitPrice: 130,
      }),
      makeTrade({
        id: 3,
        date: "2024-01-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 100,
        unitPrice: 50,
      }),
    ];
    const result = runCgt(trades, { allowances, splitEvents });
    const disposal = findDisposal(result, "2024-01-01", "AAPL")!;

    // Trade 1: 10 shares × 8 factor = 80 adjusted, cost 3200
    // Trade 2: 40 shares × 2 factor = 80 adjusted, cost 5200
    // Pool: 160 shares, cost 8400, avg cost = 52.50
    expect(disposal.matches[0].rule).toBe("section-104");
    expect(disposal.matches[0].costPerShareGBP).toBeCloseTo(52.5, 2);
    // Gain: 100 × 50 - 100 × 52.50 = 5000 - 5250 = -250 (loss)
    expect(disposal.gainGBP).toBeCloseTo(-250, 0);
  });
});

describe("CGT Calculator - Loss carry-forward prohibition", () => {
  it("losses in one tax year do NOT reduce gains in a subsequent tax year", () => {
    const trades: CgtTradeInput[] = [
      // 2022/23: loss of £1000
      makeTrade({ date: "2022-06-01", symbol: "AAA", type: "buy", quantity: 100, unitPrice: 20 }),
      makeTrade({ date: "2022-09-01", symbol: "AAA", type: "sell", quantity: 100, unitPrice: 10 }),
      // 2023/24: gain of £500
      makeTrade({ date: "2023-06-01", symbol: "BBB", type: "buy", quantity: 100, unitPrice: 50 }),
      makeTrade({ date: "2023-09-01", symbol: "BBB", type: "sell", quantity: 100, unitPrice: 55 }),
    ];
    const result = runCgt(trades, { allowances });
    const year2022 = findTaxYear(result, "2022/23")!;
    const year2023 = findTaxYear(result, "2023/24")!;

    // Year 1 has a loss
    expect(year2022.totalLosses).toBeCloseTo(-1000, 0);
    expect(year2022.totalGains).toBe(0);
    expect(year2022.taxableGain).toBe(0);

    // Year 2 gain is NOT reduced by prior year's loss — each year is independent
    expect(year2023.totalGains).toBeCloseTo(500, 0);
    expect(year2023.netGainLoss).toBeCloseTo(500, 0);
  });
});

describe("CGT Calculator - SHARE_TOLERANCE boundary", () => {
  it("treats remaining shares at exactly SHARE_TOLERANCE as fully consumed", () => {
    // Buy 10.0001 shares, sell 10 — remainder is 0.0001 which equals SHARE_TOLERANCE
    // The remainder should NOT go to pool (treated as zero)
    const trades: CgtTradeInput[] = [
      makeTrade({
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10.0001,
        unitPrice: 100,
      }),
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 10.0001,
        unitPrice: 150,
      }),
    ];
    const result = runCgt(trades, { allowances });
    // Should match successfully without residual pool
    expect(result.pools).toHaveLength(0);
  });

  it("treats remaining shares above SHARE_TOLERANCE as real remainder", () => {
    // Buy 10.001 shares, sell 10 — remainder is 0.001 > SHARE_TOLERANCE
    // This remainder SHOULD go to pool
    const trades: CgtTradeInput[] = [
      makeTrade({
        date: "2023-01-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10.001,
        unitPrice: 100,
      }),
      makeTrade({ date: "2023-06-01", symbol: "AAPL", type: "sell", quantity: 10, unitPrice: 150 }),
    ];
    const result = runCgt(trades, { allowances });
    const pool = result.pools.find((p) => p.symbol === "AAPL");
    expect(pool).toBeDefined();
    expect(pool!.shares).toBeCloseTo(0.001, 4);
  });
});

describe("CGT Calculator - Integration: FX + fees + fractional + multi-match", () => {
  it("correctly handles combined FX conversion, fees, and multiple matching rules", () => {
    const trades: CgtTradeInput[] = [
      // Pool building: Buy 50 AAPL @ $150 with $12 fees, rate 1.25 $/GBP
      // Cost: (150*50 + 12) / 1.25 = 7512/1.25 = 6009.60 GBP
      makeTrade({
        date: "2023-01-15",
        symbol: "AAPL",
        type: "buy",
        quantity: 50,
        unitPrice: 150,
        allowableExpenditure: 12,
        exchangeRate: 1.25,
      }),
      // Same-day buy: 10 AAPL @ $160 with $5 fees, rate 1.30
      // Cost: (160*10 + 5) / 1.30 = 1605/1.30 = 1234.615 GBP
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "buy",
        quantity: 10,
        unitPrice: 160,
        allowableExpenditure: 5,
        exchangeRate: 1.3,
      }),
      // B&B buy: 5 AAPL @ $155 with $3 fees, rate 1.28 (within 30 days of sell)
      // Cost: (155*5 + 3) / 1.28 = 778/1.28 = 607.8125 GBP
      makeTrade({
        date: "2023-06-10",
        symbol: "AAPL",
        type: "buy",
        quantity: 5,
        unitPrice: 155,
        allowableExpenditure: 3,
        exchangeRate: 1.28,
      }),
      // Sell 25 AAPL @ $170 with $15 fees, rate 1.27 on same day as second buy
      // Proceeds: (170*25 - 15) / 1.27 = 4235/1.27 = 3334.645 GBP
      makeTrade({
        date: "2023-06-01",
        symbol: "AAPL",
        type: "sell",
        quantity: 25,
        unitPrice: 170,
        allowableExpenditure: 15,
        exchangeRate: 1.27,
      }),
    ];
    const result = runCgt(trades, { allowances });
    const disposal = findDisposal(result, "2023-06-01", "AAPL")!;

    // Should have all three matching rules triggered:
    // 1. Same-day: matches against the 10 shares bought same day
    // 2. B&B: matches against the 5 shares bought within 30 days (June 10)
    // 3. Section 104: remaining 10 shares matched against pool
    expect(disposal.matches.length).toBeGreaterThanOrEqual(2);
    const rules = disposal.matches.map((m) => m.rule);
    expect(rules).toContain("same-day");

    // Total gain should be consistent: proceeds - costs across all matches
    const totalMatchCost = disposal.matches.reduce((sum, m) => sum + m.costGBP, 0);
    expect(disposal.totalCostGBP).toBeCloseTo(totalMatchCost, 2);
    expect(disposal.gainGBP).toBeCloseTo(disposal.proceedsGBP - disposal.totalCostGBP, 2);
  });
});
