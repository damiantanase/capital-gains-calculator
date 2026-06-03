import { describe, it, expect } from "vitest";
import { prepareTrades } from "../src/trade";
import type { CgTradeInput, CgSplitEvent } from "../src/types";

function d(s: string): Date {
  return new Date(s);
}

describe("prepareTrades — adjustment factor computation", () => {
  const split: CgSplitEvent = { date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 };

  describe("basic split adjustment", () => {
    it("applies split factor to trades before the split date", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20);
      expect(result[0].getQuantity()).toBe(200);
    });

    it("does NOT apply split factor to trades after the split date", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-07-01"), type: "buy", symbol: "AMZN", quantity: 100, unitPrice: 150 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(1);
      expect(result[0].getQuantity()).toBe(100);
    });

    it("does NOT apply split factor to trades on the same day as the split", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-06-06"), type: "buy", symbol: "AMZN", quantity: 50, unitPrice: 150 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(1);
      expect(result[0].getQuantity()).toBe(50);
    });

    it("applies split factor to trades the day before the split", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-06-05"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20);
      expect(result[0].getQuantity()).toBe(200);
    });
  });

  describe("symbol matching", () => {
    it("does NOT apply split to a different symbol", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "GOOGL", quantity: 10, unitPrice: 2500 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(1);
    });

    it("applies split only to matching symbol when multiple symbols present", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2022-01-01"), type: "buy", symbol: "AAPL", quantity: 50, unitPrice: 170 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20);
      expect(result[1].splitFactor).toBe(1);
    });
  });

  describe("multiple splits", () => {
    it("compounds factors from multiple splits on the same symbol", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2020-08-31"), symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
        { date: d("2022-06-06"), symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2020-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 300 },
      ];
      const result = prepareTrades(trades, splits);
      expect(result[0].splitFactor).toBe(8);
      expect(result[0].getQuantity()).toBe(80);
    });

    it("only applies splits that occurred after the trade", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2020-08-31"), symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
        { date: d("2022-06-06"), symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2021-06-01"), type: "buy", symbol: "AAPL", quantity: 40, unitPrice: 150 },
      ];
      const result = prepareTrades(trades, splits);
      // Only the 2022 split applies (2020 split is before the trade)
      expect(result[0].splitFactor).toBe(2);
      expect(result[0].getQuantity()).toBe(80);
    });

    it("applies no factor to a trade after all splits", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2020-08-31"), symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
        { date: d("2022-06-06"), symbol: "AAPL", ratioFrom: 1, ratioTo: 2 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2023-01-01"), type: "buy", symbol: "AAPL", quantity: 100, unitPrice: 180 },
      ];
      const result = prepareTrades(trades, splits);
      expect(result[0].splitFactor).toBe(1);
    });

    it("handles splits on different symbols independently", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2022-06-06"), symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
        { date: d("2022-07-18"), symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 5, unitPrice: 3000 },
        { date: d("2022-01-01"), type: "buy", symbol: "GOOGL", quantity: 10, unitPrice: 2800 },
      ];
      const result = prepareTrades(trades, splits);
      expect(result[0].splitFactor).toBe(20);
      expect(result[1].splitFactor).toBe(20);
    });
  });

  describe("non-standard split ratios", () => {
    it("handles fractional splits (e.g. 3:2 reverse split)", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2023-01-01"), symbol: "XYZ", ratioFrom: 3, ratioTo: 2 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "XYZ", quantity: 90, unitPrice: 10 },
      ];
      const result = prepareTrades(trades, splits);
      expect(result[0].splitFactor).toBeCloseTo(2 / 3);
      expect(result[0].getQuantity()).toBeCloseTo(60);
    });

    it("handles 1:1 split (no-op)", () => {
      const splits: CgSplitEvent[] = [
        { date: d("2023-01-01"), symbol: "XYZ", ratioFrom: 1, ratioTo: 1 },
      ];
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "XYZ", quantity: 100, unitPrice: 50 },
      ];
      const result = prepareTrades(trades, splits);
      expect(result[0].splitFactor).toBe(1);
      expect(result[0].getQuantity()).toBe(100);
    });
  });

  describe("no splits", () => {
    it("all trades have adjustment factor 1 when no split events provided", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 170 },
        { date: d("2022-06-01"), type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 180 },
      ];
      const result = prepareTrades(trades, []);
      expect(result[0].splitFactor).toBe(1);
      expect(result[1].splitFactor).toBe(1);
    });

    it("defaults to empty splits when not passed", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 170 },
      ];
      const result = prepareTrades(trades);
      expect(result[0].splitFactor).toBe(1);
    });
  });

  describe("trade types", () => {
    it("applies splits to sells the same as buys", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
        { date: d("2022-03-01"), type: "sell", symbol: "AMZN", quantity: 5, unitPrice: 3200 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20);
      expect(result[1].splitFactor).toBe(20);
    });

    it("applies splits to transfers", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "transfer", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20);
    });
  });

  describe("multiple trades at different times relative to a split", () => {
    it("correctly assigns different factors to trades before and after split", () => {
      const trades: CgTradeInput[] = [
        { date: d("2022-01-01"), type: "buy", symbol: "AMZN", quantity: 5, unitPrice: 3000 },
        { date: d("2022-06-05"), type: "buy", symbol: "AMZN", quantity: 3, unitPrice: 2900 },
        { date: d("2022-06-06"), type: "buy", symbol: "AMZN", quantity: 100, unitPrice: 150 },
        { date: d("2022-08-01"), type: "buy", symbol: "AMZN", quantity: 50, unitPrice: 140 },
      ];
      const result = prepareTrades(trades, [split]);
      expect(result[0].splitFactor).toBe(20); // before split
      expect(result[1].splitFactor).toBe(20); // day before split
      expect(result[2].splitFactor).toBe(1); // on split day (post-split)
      expect(result[3].splitFactor).toBe(1); // after split
    });
  });
});
