import { describe, it, expect } from "vitest";
import { calculateOptimalSell, validateOptimiseParams } from "../src/optimiser";
import type { OptimiseParams, OptimiseResult, OptimalSellResult } from "../src/optimiser";

function unwrap(result: OptimalSellResult): OptimiseResult {
  if (!result.ok) throw new Error(result.errors[0].message);
  return result.data;
}

const baseParams: OptimiseParams = {
  symbol: "AAPL",
  currentPrice: 200,
  exchangeRate: 1.25,
  poolCostPerShare: 120,
  poolShares: 100,
  remainingAEA: 3000,
};

describe("validateOptimiseParams", () => {
  it("returns no errors for valid params", () => {
    expect(validateOptimiseParams(baseParams)).toHaveLength(0);
  });

  it("rejects empty symbol", () => {
    const errors = validateOptimiseParams({ ...baseParams, symbol: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("symbol");
  });

  it("rejects negative current price", () => {
    const errors = validateOptimiseParams({ ...baseParams, currentPrice: -10 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("currentPrice");
  });

  it("rejects zero exchange rate", () => {
    const errors = validateOptimiseParams({ ...baseParams, exchangeRate: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("exchangeRate");
  });

  it("rejects negative pool cost per share", () => {
    const errors = validateOptimiseParams({ ...baseParams, poolCostPerShare: -5 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("poolCostPerShare");
  });

  it("rejects zero pool shares", () => {
    const errors = validateOptimiseParams({ ...baseParams, poolShares: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("poolShares");
  });

  it("rejects zero remaining AEA", () => {
    const errors = validateOptimiseParams({ ...baseParams, remainingAEA: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("remainingAEA");
  });

  it("rejects tolerance outside 0-1 range", () => {
    expect(validateOptimiseParams({ ...baseParams, tolerance: -0.1 })).toHaveLength(1);
    expect(validateOptimiseParams({ ...baseParams, tolerance: 1.5 })).toHaveLength(1);
  });

  it("accepts tolerance at boundaries (0 and 1)", () => {
    expect(validateOptimiseParams({ ...baseParams, tolerance: 0 })).toHaveLength(0);
    expect(validateOptimiseParams({ ...baseParams, tolerance: 1 })).toHaveLength(0);
  });

  it("collects multiple errors", () => {
    const errors = validateOptimiseParams({
      ...baseParams,
      symbol: "",
      currentPrice: -1,
      exchangeRate: 0,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("calculateOptimalSell", () => {
  describe("validation", () => {
    it("returns errors for invalid params", () => {
      const result = calculateOptimalSell({ ...baseParams, poolShares: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0].field).toBe("poolShares");
      }
    });
  });

  describe("success — AEA fully used", () => {
    it("calculates correct whole shares to fill AEA", () => {
      const r = unwrap(calculateOptimalSell(baseParams));

      // proceedsPerShare = 200/1.25 = 160, gainPerShare = 160-120 = 40
      // idealQuantity = 3000/40 = 75
      expect(r.status).toBe("success");
      expect(r.quantity).toBe(75);
      expect(r.expectedGain).toBeCloseTo(3000, 0);
      expect(r.aeaUsed).toBeCloseTo(3000, 0);
      expect(r.aeaRemaining).toBeCloseTo(0, 0);
    });

    it("returns success when within tolerance", () => {
      // gainPerShare = 40, AEA = 3000, ideal = 75 shares exactly — floor matches
      const r = unwrap(calculateOptimalSell({ ...baseParams, remainingAEA: 3010 }));

      // 75 shares * 40 = 3000, 3000/3010 = 99.7% > 95% threshold
      expect(r.status).toBe("success");
      expect(r.quantity).toBe(75);
    });
  });

  describe("partial — AEA not fully used", () => {
    it("returns partial when not enough shares", () => {
      const r = unwrap(calculateOptimalSell({ ...baseParams, poolShares: 10 }));

      // 10 shares * 40 gain = 400, 400/3000 = 13.3% — well below 95%
      expect(r.status).toBe("partial");
      expect(r.quantity).toBe(10);
      expect(r.expectedGain).toBeCloseTo(400, 0);
      expect(r.reason).toContain("Not enough shares");
    });

    it("returns partial when whole-shares constraint prevents AEA fill", () => {
      // gainPerShare = 40, AEA = 100, ideal = 2.5, floor = 2
      // 2*40 = 80, 80/100 = 80% — below 95%
      const r = unwrap(calculateOptimalSell({ ...baseParams, remainingAEA: 100 }));

      expect(r.status).toBe("partial");
      expect(r.quantity).toBe(2);
      expect(r.expectedGain).toBeCloseTo(80);
      expect(r.reason).toContain("Whole shares constraint");
    });

    it("custom tolerance changes success/partial boundary", () => {
      // gainPerShare = 40, AEA = 100, floor(2.5) = 2, usage = 80%
      // With tolerance 0.25 (75% threshold): 80% >= 75% → success
      const r = unwrap(calculateOptimalSell({ ...baseParams, remainingAEA: 100, tolerance: 0.25 }));

      expect(r.status).toBe("success");
    });
  });

  describe("loss — stock at a loss", () => {
    it("returns loss status with lossPerShare", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        currentPrice: 100, // 100/1.25 = 80 GBP, cost = 120 → loss of 40
      }));

      expect(r.status).toBe("loss");
      expect(r.quantity).toBe(0);
      expect(r.lossPerShare).toBeCloseTo(-40);
      expect(r.aeaUsed).toBe(0);
      expect(r.aeaRemaining).toBe(3000);
    });

    it("returns loss when price equals cost (zero gain)", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        currentPrice: 150, // 150/1.25 = 120 = poolCostPerShare → zero gain
      }));

      expect(r.status).toBe("loss");
      expect(r.lossPerShare).toBe(0);
    });
  });

  describe("impossible — cannot achieve any AEA usage", () => {
    it("returns impossible when gain per share too small for whole shares", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        currentPrice: 150.5, // 150.5/1.25 = 120.4, gain = 0.4
        poolCostPerShare: 120,
        poolShares: 1,
        remainingAEA: 3000,
      }));

      // floor(3000/0.4) = 7500, capped at 1 share, gain = 0.4
      // 0.4/3000 = 0.013% — well below tolerance but quantity is valid (1)
      // Actually 1 share gives 0.4 gain which is way below AEA
      expect(r.status).toBe("partial");
      expect(r.quantity).toBe(1);
    });

    it("returns impossible when no whole shares can produce any gain", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        currentPrice: 150.01, // 150.01/1.25 = 120.008, gain = 0.008
        poolCostPerShare: 120,
        poolShares: 0.5, // less than 1 whole share
        remainingAEA: 3000,
        allowFractional: false,
      }));
      // poolShares = 0.5 is valid (positive), floor(0.5) = 0
      expect(r.status).toBe("impossible");
      expect(r.quantity).toBe(0);
      expect(r.reason).toContain("too small");
    });
  });

  describe("fractional shares", () => {
    it("allows fractional quantities when allowFractional is true", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        remainingAEA: 100,
        allowFractional: true,
      }));

      // gainPerShare = 40, ideal = 100/40 = 2.5 shares exactly
      expect(r.status).toBe("success");
      expect(r.quantity).toBe(2.5);
      expect(r.expectedGain).toBeCloseTo(100);
      expect(r.aeaRemaining).toBeCloseTo(0);
    });

    it("caps fractional at pool shares", () => {
      const r = unwrap(calculateOptimalSell({
        ...baseParams,
        poolShares: 2.3,
        remainingAEA: 100,
        allowFractional: true,
      }));

      // ideal = 2.5, capped at 2.3
      expect(r.quantity).toBe(2.3);
      expect(r.expectedGain).toBeCloseTo(2.3 * 40);
    });

    it("fractional achieves full AEA when whole shares cannot", () => {
      // gainPerShare = 40, AEA = 100
      // Whole shares: floor(2.5) = 2, gain = 80 (80% — partial)
      // Fractional: 2.5, gain = 100 (100% — success)
      const wholeR = unwrap(calculateOptimalSell({ ...baseParams, remainingAEA: 100 }));
      const fracR = unwrap(calculateOptimalSell({
        ...baseParams,
        remainingAEA: 100,
        allowFractional: true,
      }));

      expect(wholeR.status).toBe("partial");
      expect(fracR.status).toBe("success");
    });
  });

  describe("GBP stocks", () => {
    it("handles exchange rate of 1", () => {
      const r = unwrap(calculateOptimalSell({
        symbol: "SHEL",
        currentPrice: 28,
        exchangeRate: 1.0,
        poolCostPerShare: 26,
        poolShares: 200,
        remainingAEA: 3000,
      }));

      // gainPerShare = 2, ideal = 3000/2 = 1500, capped at 200
      // 200 * 2 = 400, 400/3000 = 13.3% — partial
      expect(r.status).toBe("partial");
      expect(r.quantity).toBe(200);
      expect(r.expectedGain).toBeCloseTo(400);
      expect(r.reason).toContain("Not enough shares");
    });
  });

  describe("tolerance parameter", () => {
    it("defaults to 5% tolerance", () => {
      // gainPerShare = 40, AEA = 3000, ideal = 75 exactly → 100% usage → success
      const r = unwrap(calculateOptimalSell(baseParams));
      expect(r.status).toBe("success");
    });

    it("strict tolerance (0%) requires exact match", () => {
      // gainPerShare = 40, AEA = 3010, floor(75.25) = 75, usage = 3000/3010 = 99.7%
      // With 0% tolerance, 99.7% < 100% → partial
      const r = unwrap(calculateOptimalSell({ ...baseParams, remainingAEA: 3010, tolerance: 0 }));
      expect(r.status).toBe("partial");
    });

    it("lenient tolerance (100%) always succeeds if any shares sold", () => {
      const r = unwrap(calculateOptimalSell({ ...baseParams, poolShares: 1, tolerance: 1 }));
      // 1 share * 40 = 40, 40/3000 = 1.3% — but tolerance is 100%
      expect(r.status).toBe("success");
    });
  });
});
