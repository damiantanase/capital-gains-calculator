import { describe, it, expect } from "vitest";
import { normaliseTrades } from "../src/normalise";
import type { NormaliseOptions, NormaliseResult } from "../src/normalise";
import type { CgtTradeInput } from "../src/trade";

function runNormalise(inputs: CgtTradeInput[], options?: NormaliseOptions): NormaliseResult {
  const result = normaliseTrades(inputs, options);
  if (!result.ok) return { transactions: [], errors: result.errors };
  return result.data;
}

describe("normaliseTrades", () => {
  describe("validation", () => {
    it("rejects trades before 2008/09 tax year", () => {
      const result = normaliseTrades([
        { date: "2008-04-05", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].field).toBe("date");
        expect(result.errors[0].message).toContain("before 6 April 2008");
      }
    });

    it("accepts trades on 6 April 2008", () => {
      const result = runNormalise([
        { date: "2008-04-06", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
    });

    it("rejects negative quantity", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: -5, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("quantity");
      expect(result.errors[0].message).toContain("positive");
    });

    it("rejects zero quantity", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 0, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("quantity");
    });

    it("rejects negative unit price", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: -50 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("unitPrice");
    });

    it("allows zero unit price (e.g. bonus shares)", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 0 },
      ]);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects negative fees", () => {
      const result = runNormalise([
        {
          date: "2023-01-01",
          type: "buy",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: 100,
          allowableExpenditure: -5,
        },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("allowableExpenditure");
    });

    it("rejects zero exchange rate", () => {
      const result = runNormalise([
        {
          date: "2023-01-01",
          type: "buy",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: 100,
          exchangeRate: 0,
        },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("exchangeRate");
    });

    it("rejects negative exchange rate", () => {
      const result = runNormalise([
        {
          date: "2023-01-01",
          type: "buy",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: 100,
          exchangeRate: -1.5,
        },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("exchangeRate");
    });

    it("rejects invalid trade type", () => {
      const result = runNormalise([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { date: "2023-01-01", type: "short" as any, symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("type");
      expect(result.errors[0].message).toContain("'buy', 'sell', or 'transfer'");
    });

    it("rejects invalid date format", () => {
      const result = runNormalise([
        { date: "01/01/2023", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("date");
    });

    it("rejects empty symbol", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("symbol");
    });

    it("collects multiple errors from the same trade", () => {
      const result = runNormalise([
        { date: "2007-01-01", type: "buy", symbol: "AAPL", quantity: -5, unitPrice: -10 },
      ]);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it("reports which trade index has the error", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-02", type: "buy", symbol: "AAPL", quantity: -5, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].index).toBe(1);
    });
  });

  describe("position validation", () => {
    it("rejects selling more shares than owned", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 15, unitPrice: 150 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("quantity");
      expect(result.errors[0].message).toContain("Cannot sell");
    });

    it("allows selling exactly the amount owned", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 10, unitPrice: 150 },
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
    });

    it("tracks positions across multiple buys", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-03-01", type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
        { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 14, unitPrice: 150 },
      ]);
      expect(result.errors).toHaveLength(0);
    });

    it("tracks positions per symbol independently", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-01", type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 100 },
        { date: "2023-06-01", type: "sell", symbol: "GOOGL", quantity: 8, unitPrice: 150 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("GOOGL");
    });

    it("accounts for stock splits in position tracking", () => {
      const result = runNormalise(
        [
          { date: "2022-01-01", type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
          { date: "2023-01-01", type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
        ],
        { splitEvents: [{ date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }] }
      );
      expect(result.errors).toHaveLength(0);
    });

    it("rejects selling more than split-adjusted position", () => {
      const result = runNormalise(
        [
          { date: "2022-01-01", type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
          { date: "2023-01-01", type: "sell", symbol: "AMZN", quantity: 201, unitPrice: 150 },
        ],
        { splitEvents: [{ date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }] }
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Cannot sell");
    });

    it("treats transfers as decreasing position (transfer out)", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 20, unitPrice: 100 },
        { date: "2023-06-01", type: "transfer", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-09-01", type: "sell", symbol: "AAPL", quantity: 10, unitPrice: 150 },
      ]);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects transfer out exceeding available shares", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-06-01", type: "transfer", symbol: "AAPL", quantity: 15, unitPrice: 100 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Cannot transfer");
    });
  });

  describe("normalisation", () => {
    it("converts values to GBP using exchange rate", () => {
      const result = runNormalise([
        {
          date: "2023-01-01",
          type: "buy",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: 150,
          exchangeRate: 1.25,
          allowableExpenditure: 12.5,
        },
      ]);
      expect(result.transactions).toHaveLength(1);
      const tx = result.transactions[0];
      // valueGBP for buy = (unitPrice * quantity + fees) / exchangeRate = (1500 + 12.5) / 1.25 = 1210
      expect(tx.valueGBP).toBeCloseTo(1210, 2);
      // feesGBP = 12.5 / 1.25 = 10
      expect(tx.feesGBP).toBeCloseTo(10, 2);
    });

    it("defaults exchange rate to 1 (GBP trades)", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "VOD", quantity: 100, unitPrice: 1.5 },
      ]);
      const tx = result.transactions[0];
      expect(tx.valueGBP).toBeCloseTo(150, 2);
    });

    it("for sells, valueGBP is proceeds minus fees", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        {
          date: "2023-06-01",
          type: "sell",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: 150,
          allowableExpenditure: 10,
        },
      ]);
      const sell = result.transactions.find((t) => t.type === "sell")!;
      // valueGBP for sell = (unitPrice * quantity - fees) / exchangeRate = (1500 - 10) / 1 = 1490
      expect(sell.valueGBP).toBeCloseTo(1490, 2);
    });

    it("merges same-day, same-symbol, same-type trades", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
      ]);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].originalQuantity).toBe(15);
      expect(result.transactions[0].mergedFrom).toHaveLength(2);
    });

    it("does not merge different dates", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-02", type: "buy", symbol: "AAPL", quantity: 5, unitPrice: 110 },
      ]);
      expect(result.transactions).toHaveLength(2);
    });

    it("does not merge different symbols", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-01", type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 110 },
      ]);
      expect(result.transactions).toHaveLength(2);
    });

    it("does not merge different types", () => {
      const result2 = runNormalise([
        { date: "2022-06-01", type: "buy", symbol: "AAPL", quantity: 20, unitPrice: 80 },
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2023-01-01", type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 150 },
      ]);
      // 3 inputs but buy on 2022, buy+sell on 2023-01-01 are different types = 3 transactions
      expect(result2.transactions).toHaveLength(3);
    });

    it("sorts output chronologically", () => {
      const result = runNormalise([
        { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 150 },
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.transactions[0].date).toBe("2023-01-01");
      expect(result.transactions[1].date).toBe("2023-06-01");
    });

    it("adjusts quantities for stock splits", () => {
      const result = runNormalise(
        [
          { date: "2022-01-01", type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
          { date: "2023-01-01", type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
        ],
        { splitEvents: [{ date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }] }
      );
      const buy = result.transactions.find((t) => t.type === "buy")!;
      expect(buy.originalQuantity).toBe(10);
      expect(buy.quantity).toBe(200);
    });

    it("includes adjustmentFactor on transactions", () => {
      const result = runNormalise(
        [
          { date: "2022-01-01", type: "buy", symbol: "AMZN", quantity: 10, unitPrice: 3000 },
          { date: "2023-01-01", type: "sell", symbol: "AMZN", quantity: 100, unitPrice: 150 },
        ],
        { splitEvents: [{ date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 }] }
      );
      const buy = result.transactions.find((t) => t.type === "buy")!;
      const sell = result.transactions.find((t) => t.type === "sell")!;
      expect(buy.adjustmentFactor).toBe(20);
      expect(sell.adjustmentFactor).toBe(1);
    });

    it("adjustmentFactor is 1 when no splits apply", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
      ]);
      expect(result.transactions[0].adjustmentFactor).toBe(1);
    });
  });

  describe("skipInvalid mode", () => {
    it("returns valid transactions alongside errors when skipInvalid is true", () => {
      const result = runNormalise(
        [
          { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
          { date: "2007-01-01", type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 50 },
          { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 5, unitPrice: 150 },
        ],
        { skipInvalid: true }
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].index).toBe(1);
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].symbol).toBe("AAPL");
      expect(result.transactions[0].type).toBe("buy");
      expect(result.transactions[1].type).toBe("sell");
    });

    it("removes invalid sells that exceed position", () => {
      const result = runNormalise(
        [
          { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
          { date: "2023-06-01", type: "sell", symbol: "AAPL", quantity: 20, unitPrice: 150 },
        ],
        { skipInvalid: true }
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Cannot sell");
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe("buy");
    });

    it("keeps all valid trades when only some have input errors", () => {
      const result = runNormalise(
        [
          { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
          { date: "2023-02-01", type: "buy", symbol: "AAPL", quantity: -5, unitPrice: 100 },
          { date: "2023-03-01", type: "buy", symbol: "AAPL", quantity: 3, unitPrice: 110 },
        ],
        { skipInvalid: true }
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].index).toBe(1);
      expect(result.transactions).toHaveLength(2);
    });

    it("returns empty transactions when all inputs are invalid", () => {
      const result = runNormalise(
        [
          { date: "2007-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
          { date: "2006-01-01", type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 50 },
        ],
        { skipInvalid: true }
      );
      expect(result.errors).toHaveLength(2);
      expect(result.transactions).toHaveLength(0);
    });

    it("without skipInvalid, returns no transactions on any error (default)", () => {
      const result = runNormalise([
        { date: "2023-01-01", type: "buy", symbol: "AAPL", quantity: 10, unitPrice: 100 },
        { date: "2007-01-01", type: "buy", symbol: "GOOGL", quantity: 5, unitPrice: 50 },
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.transactions).toHaveLength(0);
    });
  });
});
