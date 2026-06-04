import { describe, it, expect } from "vitest";
import { calculateCgt } from "../src/calculate";
import { CgValidationError } from "../src/errors";
import { validateInputs, validatePositions } from "../src/validate";
import { prepareTrades } from "../src/trade";
import { getLatestSupportedTaxYear } from "../src/hmrc-config";
import type { CgTradeInput, CgSplitEvent } from "../src/types";

function d(s: string): Date {
  return new Date(s);
}

function normalise(inputs: CgTradeInput[], splitEvents?: CgSplitEvent[]) {
  return calculateCgt(inputs, { splitEvents }).normalisedTransactions;
}

function checkPositions(inputs: CgTradeInput[], splitEvents: CgSplitEvent[] = []) {
  return validatePositions(prepareTrades(inputs, splitEvents));
}

describe("validation", () => {
  it("rejects trades before 2008/09 tax year", () => {
    const inputs: CgTradeInput[] = [
      { date: d("2008-04-05"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ];
    expect(() => calculateCgt(inputs)).toThrow(CgValidationError);
    const errors = validateInputs(inputs);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("date");
    expect(errors[0].message).toContain("the earliest supported tax year is 2008/09");
  });

  it("accepts trades on 6 April 2008", () => {
    const txs = normalise([
      { date: d("2008-04-06"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(txs).toHaveLength(1);
  });

  // Boundaries derived from the HMRC config so these survive new tax-year additions.
  const latestTaxYear = getLatestSupportedTaxYear();
  const latestStartYear = Number(latestTaxYear.slice(0, 4));
  const lastAcceptedDate = new Date(Date.UTC(latestStartYear + 1, 3, 5)); // 5 April of end-year
  const firstRejectedDate = new Date(Date.UTC(latestStartYear + 1, 3, 6)); // 6 April of end-year

  it("rejects trades past the latest supported tax year", () => {
    const errors = validateInputs([
      { date: firstRejectedDate, type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("date");
    expect(errors[0].message).toContain(latestTaxYear);
  });

  it("throws via calculateCgt for a trade past the latest supported tax year", () => {
    expect(() =>
      calculateCgt([
        { date: firstRejectedDate, type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ])
    ).toThrow(CgValidationError);
  });

  it("accepts trades on the last day of the latest supported tax year (5 April)", () => {
    const txs = normalise([
      { date: lastAcceptedDate, type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(txs).toHaveLength(1);
  });

  it("accepts trades mid-way through the latest supported tax year", () => {
    const midLatestYear = new Date(Date.UTC(latestStartYear, 6, 1)); // 1 July of start-year
    const txs = normalise([
      { date: midLatestYear, type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(txs).toHaveLength(1);
  });

  it("collects both lower- and upper-bound date errors together", () => {
    const errors = validateInputs([
      { date: d("2007-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: firstRejectedDate, type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 50 },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0].index).toBe(0);
    expect(errors[0].field).toBe("date");
    expect(errors[1].index).toBe(1);
    expect(errors[1].field).toBe("date");
  });

  it("rejects negative quantity", () => {
    const errors = validateInputs([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: -5, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("quantity");
    expect(errors[0].message).toContain("positive");
  });

  it("rejects zero quantity", () => {
    const errors = validateInputs([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 0, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("quantity");
  });

  it("rejects negative unit price", () => {
    const errors = validateInputs([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: -50 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("unitPrice");
  });

  it("allows zero unit price (e.g. bonus shares)", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 0 },
    ]);
    expect(txs).toHaveLength(1);
  });

  it("rejects negative fees", () => {
    const errors = validateInputs([
      {
        date: d("2023-01-01"),
        type: "buy",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 100,
        allowableExpenditure: -5,
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("allowableExpenditure");
  });

  it("rejects zero exchange rate", () => {
    const errors = validateInputs([
      {
        date: d("2023-01-01"),
        type: "buy",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 100,
        exchangeRate: 0,
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("exchangeRate");
  });

  it("rejects negative exchange rate", () => {
    const errors = validateInputs([
      {
        date: d("2023-01-01"),
        type: "buy",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 100,
        exchangeRate: -1.5,
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("exchangeRate");
  });

  it("rejects invalid trade type", () => {
    const errors = validateInputs([
      {
        date: d("2023-01-01"),
        type: "short" as any,
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 100,
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("type");
    expect(errors[0].message).toContain("'buy', 'sell', or 'transfer'");
  });

  it("rejects invalid Date object", () => {
    const errors = validateInputs([
      {
        date: new Date("garbage") as any,
        type: "buy",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 100,
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("date");
  });

  it("rejects empty symbol", () => {
    const errors = validateInputs([
      { date: d("2023-01-01"), type: "buy", symbol: "", quantity: 10, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("symbol");
  });

  it("collects multiple errors from the same trade", () => {
    const errors = validateInputs([
      { date: d("2007-01-01"), type: "buy", symbol: "AAPL", quantity: -5, unitPrice: -10 },
    ]);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("reports which trade index has the error", () => {
    const errors = validateInputs([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-02"), type: "buy", symbol: "AAPL", quantity: -5, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(1);
  });
});

describe("position validation", () => {
  it("rejects selling more shares than owned", () => {
    const errors = checkPositions([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-06-01"), type: "sell", symbol: "AAPL", quantity: 15, unitPrice: 150 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("quantity");
    expect(errors[0].message).toContain("Cannot sell");
  });

  it("allows selling exactly the amount owned", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-06-01"), type: "sell", symbol: "AAPL", quantity: 10, unitPrice: 150 },
    ]);
    expect(txs).toHaveLength(2);
  });

  it("tracks positions across multiple buys", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-03-01"), type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
      { date: d("2023-06-01"), type: "sell", symbol: "AAPL", quantity: 14, unitPrice: 150 },
    ]);
    expect(txs).toHaveLength(3);
  });

  it("tracks positions per symbol independently", () => {
    const errors = checkPositions([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-01"), type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 100 },
      { date: d("2023-06-01"), type: "sell", symbol: "GOOGL", quantity: 8, unitPrice: 150 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("GOOGL");
  });

  it("accounts for stock splits in position tracking", () => {
    const txs = normalise(
      [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2023-01-01"), type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
      ],
      [{ date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }]
    );
    expect(txs).toHaveLength(2);
  });

  it("rejects selling more than split-adjusted position", () => {
    const errors = checkPositions(
      [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2023-01-01"), type: "sell", symbol: "AMZN", quantity: 201, unitPrice: 150 },
      ],
      [{ date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }]
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Cannot sell");
    expect(errors[0].message).toContain("AMZN");
  });

  it("reports available shares adjusted for splits after the failing sell", () => {
    const errors = checkPositions(
      [
        { date: d("2022-01-01"), type: "buy", symbol: "TSLA", quantity: 5, unitPrice: 800 },
        { date: d("2022-06-01"), type: "sell", symbol: "TSLA", quantity: 20, unitPrice: 300 },
      ],
      [{ date: d("2022-08-25"), symbol: "TSLA", ratioFrom: 1, ratioTo: 3 }]
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Cannot sell");
    expect(errors[0].message).toContain("TSLA");
    // The available figure is reported in the user's ORIGINAL (pre-split) share terms:
    // 5 shares held, de-adjusted by the trade's own 3x split factor (current / splitFactor).
    // Asserting the number guards validate.ts:116 against `*` replacing `/` (which would
    // report 45.0000 instead of 5.0000).
    expect(errors[0].message).toContain("only 5.0000 shares available");
  });

  it("treats transfers as decreasing position (transfer out)", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 20, unitPrice: 100 },
      { date: d("2023-06-01"), type: "transfer", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-09-01"), type: "sell", symbol: "AAPL", quantity: 10, unitPrice: 150 },
    ]);
    expect(txs).toHaveLength(3);
  });

  it("rejects transfer out exceeding available shares", () => {
    const errors = checkPositions([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-06-01"), type: "transfer", symbol: "AAPL", quantity: 15, unitPrice: 100 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Cannot transfer");
  });
});

describe("normalisation", () => {
  it("converts values to GBP using exchange rate", () => {
    const txs = normalise([
      {
        date: d("2023-01-01"),
        type: "buy",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 150,
        exchangeRate: 1.25,
        allowableExpenditure: 12.5,
      },
    ]);
    expect(txs).toHaveLength(1);
    // valueGBP for buy = (unitPrice * quantity + fees) / exchangeRate = (1500 + 12.5) / 1.25 = 1210
    expect(txs[0].valueGBP).toBeCloseTo(1210, 2);
    // feesGBP = 12.5 / 1.25 = 10
    expect(txs[0].feesGBP).toBeCloseTo(10, 2);
  });

  it("defaults exchange rate to 1 (GBP trades)", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "VOD", quantity: 100, unitPrice: 1.5 },
    ]);
    expect(txs[0].valueGBP).toBeCloseTo(150, 2);
  });

  it("for sells, valueGBP is proceeds minus fees", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      {
        date: d("2023-06-01"),
        type: "sell",
        symbol: "AAPL",
        quantity: 10,
        unitPrice: 150,
        allowableExpenditure: 10,
      },
    ]);
    const sell = txs.find((t) => t.type === "sell")!;
    // valueGBP for sell = (unitPrice * quantity - fees) / exchangeRate = (1500 - 10) / 1 = 1490
    expect(sell.valueGBP).toBeCloseTo(1490, 2);
  });

  it("merges same-day, same-symbol, same-type trades", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
    ]);
    expect(txs).toHaveLength(1);
    expect(txs[0].originalQuantity).toBe(15);
    expect(txs[0].inputIndices).toHaveLength(2);
  });

  it("does not merge different dates", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-02"), type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
    ]);
    expect(txs).toHaveLength(2);
  });

  it("does not merge different symbols", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-01"), type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 110 },
    ]);
    expect(txs).toHaveLength(2);
  });

  it("does not merge different types", () => {
    const txs = normalise([
      { date: d("2022-06-01"), type: "buy", symbol: "AAPL", quantity: 20, unitPrice: 80 },
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      { date: d("2023-01-01"), type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 150 },
    ]);
    expect(txs).toHaveLength(3);
  });

  it("sorts output chronologically", () => {
    const txs = normalise([
      { date: d("2023-06-01"), type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 150 },
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(txs[0].date).toEqual(d("2023-01-01"));
    expect(txs[1].date).toEqual(d("2023-06-01"));
  });

  it("adjusts quantities for stock splits", () => {
    const txs = normalise(
      [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2023-01-01"), type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
      ],
      [{ date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }]
    );
    const buy = txs.find((t) => t.type === "buy")!;
    expect(buy.originalQuantity).toBe(10);
    expect(buy.originalQuantity * buy.splitFactor).toBe(200);
  });

  it("includes splitFactor on transactions", () => {
    const txs = normalise(
      [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2023-01-01"), type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
      ],
      [{ date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }]
    );
    const buy = txs.find((t) => t.type === "buy")!;
    const sell = txs.find((t) => t.type === "sell")!;
    expect(buy.splitFactor).toBe(20);
    expect(sell.splitFactor).toBe(1);
  });

  it("splitFactor is 1 when no splits apply", () => {
    const txs = normalise([
      { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
    ]);
    expect(txs[0].splitFactor).toBe(1);
  });
});

describe("validation throws CgValidationError with all details", () => {
  it("fails with error when any input is invalid", () => {
    expect(() =>
      calculateCgt([
        { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: d("2007-01-01"), type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 50 },
      ])
    ).toThrow(CgValidationError);
    try {
      calculateCgt([
        { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: d("2007-01-01"), type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 50 },
      ]);
    } catch (e) {
      const err = e as CgValidationError;
      expect(err.errors).toHaveLength(1);
      expect(err.errors[0].index).toBe(1);
    }
  });
});
