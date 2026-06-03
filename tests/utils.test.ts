import { describe, it, expect } from "vitest";
import {
  isZeroShares,
  assertDefined,
  daysBetween,
  formatDate,
  toUtcMidnight,
  deriveMatchCostGBP,
  deriveMatchGainGBP,
  deriveMatchedDate,
  deriveEventCostGBP,
  deriveEventGainGBP,
  derivePoolImpact,
  sumNetGain,
  sumProceeds,
  sumCosts,
  sumFees,
  sumGains,
  sumLosses,
  countDisposals,
  countAcquisitions,
  type EventDeriveContext,
} from "../src/utils";
import type { CgEvent, CgMatch, CgNormalisedTransaction, CgSection104Pool } from "../src/types";

function d(s: string): Date {
  return new Date(s);
}

describe("isZeroShares", () => {
  it("treats values within tolerance as zero", () => {
    expect(isZeroShares(0)).toBe(true);
    expect(isZeroShares(0.0001)).toBe(true);
  });

  it("treats values above tolerance as non-zero", () => {
    expect(isZeroShares(0.001)).toBe(false);
    expect(isZeroShares(10)).toBe(false);
  });
});

describe("assertDefined", () => {
  it("returns the value when it is defined", () => {
    expect(assertDefined(42, "number missing")).toBe(42);
    expect(assertDefined(0, "zero missing")).toBe(0);
    expect(assertDefined("", "empty string missing")).toBe("");
  });

  it("throws with the given message when the value is undefined", () => {
    expect(() => assertDefined(undefined, "pool missing for symbol")).toThrow(
      "Internal invariant violated: pool missing for symbol"
    );
  });
});

describe("daysBetween", () => {
  it("returns whole days, positive when the second date is later", () => {
    expect(daysBetween(d("2023-06-01"), d("2023-07-01"))).toBe(30);
    expect(daysBetween(d("2023-06-01"), d("2023-06-02"))).toBe(1);
  });

  it("returns 0 for the same date and negative when the second date is earlier", () => {
    expect(daysBetween(d("2023-06-01"), d("2023-06-01"))).toBe(0);
    expect(daysBetween(d("2023-07-01"), d("2023-06-01"))).toBe(-30);
  });
});

describe("toUtcMidnight", () => {
  it("strips the time-of-day component, keeping the UTC calendar day", () => {
    expect(toUtcMidnight(d("2023-03-01T15:45:30.500Z")).toISOString()).toBe(
      "2023-03-01T00:00:00.000Z"
    );
  });

  it("is a no-op for a date already at UTC midnight", () => {
    expect(toUtcMidnight(d("2023-03-01")).toISOString()).toBe("2023-03-01T00:00:00.000Z");
  });

  it("uses UTC components so two same-UTC-day instants collapse to one value", () => {
    const a = toUtcMidnight(d("2023-03-01T00:00:00Z")).getTime();
    const b = toUtcMidnight(d("2023-03-01T23:59:59Z")).getTime();
    expect(a).toBe(b);
  });
});

describe("formatDate", () => {
  it("formats a Date to YYYY-MM-DD string", () => {
    expect(formatDate(d("2024-04-05"))).toBe("2024-04-05");
    expect(formatDate(d("2024-01-01"))).toBe("2024-01-01");
    expect(formatDate(d("2024-12-31"))).toBe("2024-12-31");
  });

  it("zero-pads month and day", () => {
    expect(formatDate(d("2024-02-09"))).toBe("2024-02-09");
  });

  it("handles leap year", () => {
    expect(formatDate(d("2024-02-29"))).toBe("2024-02-29");
  });
});

// --- Derivation formulas (also exercised end-to-end via calculator.test.ts) ---

const pool: CgSection104Pool[] = [{ symbol: "AAPL", shares: 100, costGBP: 5000 }];

const buyCtx: EventDeriveContext = {
  type: "buy",
  symbol: "AAPL",
  splitFactor: 1,
  quantity: 50,
  valueGBP: 3000,
  poolBefore: pool,
};

const sellCtx: EventDeriveContext = {
  type: "sell",
  symbol: "AAPL",
  splitFactor: 1,
  quantity: 50,
  valueGBP: 4000, // £80 per share
  poolBefore: pool,
};

const transactions: CgNormalisedTransaction[] = [
  {
    normalisedTradeId: 7,
    date: d("2023-01-10"),
    type: "buy",
    symbol: "AAPL",
    originalQuantity: 50,
    splitFactor: 1,
    quantity: 50,
    valueGBP: 2500, // £50 per share
    feesGBP: 0,
    inputIndices: [0],
  },
];

describe("deriveMatchCostGBP", () => {
  it("uses the pool weighted-average cost for section-104 matches", () => {
    const m: CgMatch = { rule: "section-104", originalMatchedQuantity: 50, costGBP: 0, gainGBP: 0 };
    // pool cost per share = 5000/100 = 50; 50 shares → 2500
    expect(deriveMatchCostGBP(m, sellCtx, transactions)).toBeCloseTo(2500, 6);
  });

  it("returns 0 for a section-104 match against an empty/zero pool", () => {
    const m: CgMatch = { rule: "section-104", originalMatchedQuantity: 50, costGBP: 0, gainGBP: 0 };
    const emptyCtx: EventDeriveContext = { ...sellCtx, poolBefore: [] };
    expect(deriveMatchCostGBP(m, emptyCtx, transactions)).toBe(0);
    const zeroCtx: EventDeriveContext = {
      ...sellCtx,
      poolBefore: [{ symbol: "AAPL", shares: 0, costGBP: 0 }],
    };
    expect(deriveMatchCostGBP(m, zeroCtx, transactions)).toBe(0);
  });

  it("uses the counterparty trade cost for same-day/B&B matches", () => {
    const m: CgMatch = {
      rule: "same-day",
      originalMatchedQuantity: 40,
      normalisedTradeId: 7,
      costGBP: 0,
      gainGBP: 0,
    };
    // counterparty cost per share = 2500/50 = 50; 40 shares → 2000
    expect(deriveMatchCostGBP(m, sellCtx, transactions)).toBeCloseTo(2000, 6);
  });
});

describe("deriveMatchGainGBP", () => {
  it("returns proceeds minus cost for sells", () => {
    const m: CgMatch = {
      rule: "section-104",
      originalMatchedQuantity: 50,
      costGBP: 2500,
      gainGBP: 0,
    };
    // proceeds per share = 4000/50 = 80; 50 shares → 4000; minus cost 2500 → 1500
    expect(deriveMatchGainGBP(m, sellCtx, 2500)).toBeCloseTo(1500, 6);
  });

  it("returns 0 for buys and transfers", () => {
    const m: CgMatch = {
      rule: "section-104",
      originalMatchedQuantity: 50,
      costGBP: 2500,
      gainGBP: 0,
    };
    expect(deriveMatchGainGBP(m, buyCtx, 2500)).toBe(0);
  });
});

describe("deriveMatchedDate", () => {
  it("returns the counterparty date when present", () => {
    const m: CgMatch = {
      rule: "same-day",
      originalMatchedQuantity: 40,
      normalisedTradeId: 7,
      costGBP: 0,
      gainGBP: 0,
    };
    expect(deriveMatchedDate(m, transactions)).toEqual(d("2023-01-10"));
  });

  it("returns undefined for section-104 (no counterparty id)", () => {
    const m: CgMatch = { rule: "section-104", originalMatchedQuantity: 50, costGBP: 0, gainGBP: 0 };
    expect(deriveMatchedDate(m, transactions)).toBeUndefined();
  });

  it("returns undefined when the id is not found", () => {
    const m: CgMatch = {
      rule: "same-day",
      originalMatchedQuantity: 1,
      normalisedTradeId: 999,
      costGBP: 0,
      gainGBP: 0,
    };
    expect(deriveMatchedDate(m, transactions)).toBeUndefined();
  });
});

describe("deriveEventCostGBP / deriveEventGainGBP", () => {
  const matches: CgMatch[] = [
    { rule: "section-104", originalMatchedQuantity: 30, costGBP: 1500, gainGBP: 0 },
    {
      rule: "same-day",
      originalMatchedQuantity: 20,
      normalisedTradeId: 7,
      costGBP: 1000,
      gainGBP: 0,
    },
  ];

  it("sums match costs", () => {
    expect(deriveEventCostGBP(matches)).toBe(2500);
  });

  it("computes event gain as proceeds minus total cost for sells", () => {
    // matched 50 shares, proceeds per share 80 → 4000; cost 2500 → 1500
    expect(deriveEventGainGBP(sellCtx, matches, 2500)).toBeCloseTo(1500, 6);
  });

  it("returns 0 gain for non-sells", () => {
    expect(deriveEventGainGBP(buyCtx, matches, 2500)).toBe(0);
  });
});

describe("derivePoolImpact", () => {
  it("returns the share/cost delta when the pool changes", () => {
    const before: CgSection104Pool[] = [{ symbol: "AAPL", shares: 100, costGBP: 5000 }];
    const after: CgSection104Pool[] = [{ symbol: "AAPL", shares: 150, costGBP: 7500 }];
    expect(derivePoolImpact(before, after, "AAPL")).toEqual({
      sharesDelta: 50,
      costDeltaGBP: 2500,
    });
  });

  it("treats a missing side as zero", () => {
    const after: CgSection104Pool[] = [{ symbol: "AAPL", shares: 100, costGBP: 5000 }];
    expect(derivePoolImpact([], after, "AAPL")).toEqual({ sharesDelta: 100, costDeltaGBP: 5000 });
  });

  it("returns null when the change is within tolerance", () => {
    const same: CgSection104Pool[] = [{ symbol: "AAPL", shares: 100, costGBP: 5000 }];
    expect(derivePoolImpact(same, same, "AAPL")).toBeNull();
  });
});

describe("aggregation helpers", () => {
  function ev(over: Partial<CgEvent> & { type: CgEvent["type"]; gainGBP: number }): CgEvent {
    return {
      date: d("2023-06-01"),
      symbol: "X",
      originalQuantity: 1,
      splitFactor: 1,
      quantity: 1,
      valueGBP: over.type === "sell" ? 100 : 0,
      feesGBP: 0,
      matches: [],
      costGBP: 0,
      poolBefore: [],
      poolAfter: [],
      poolImpact: null,
      ...over,
    };
  }

  const events: CgEvent[] = [
    ev({ type: "buy", gainGBP: 0, feesGBP: 10 }),
    ev({ type: "sell", gainGBP: 500, valueGBP: 1500, costGBP: 1000, feesGBP: 8 }),
    ev({ type: "sell", gainGBP: -400, valueGBP: 600, costGBP: 1000, feesGBP: 5 }),
    ev({ type: "transfer", gainGBP: 0, feesGBP: 3 }),
  ];

  it("sumNetGain sums sell gains", () => {
    expect(sumNetGain(events)).toBeCloseTo(100, 6);
  });
  it("sumFees sums fees across all events (buys, sells, and transfers)", () => {
    expect(sumFees(events)).toBeCloseTo(26, 6); // 10 + 8 + 5 + 3
  });
  it("sumProceeds sums sell values", () => {
    expect(sumProceeds(events)).toBeCloseTo(2100, 6);
  });
  it("sumCosts sums sell costs", () => {
    expect(sumCosts(events)).toBeCloseTo(2000, 6);
  });
  it("sumGains sums positive sell gains only", () => {
    expect(sumGains(events)).toBeCloseTo(500, 6);
  });
  it("sumLosses sums negative sell gains only", () => {
    expect(sumLosses(events)).toBeCloseTo(-400, 6);
  });
  it("countDisposals counts sells and transfers", () => {
    expect(countDisposals(events)).toBe(3);
  });
  it("countAcquisitions counts buys", () => {
    expect(countAcquisitions(events)).toBe(1);
  });
});
