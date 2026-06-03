// =============================================================================
// Calculator inputs
// =============================================================================

/** A single trade event provided by the consumer. */
export interface CgTradeInput {
  /**
   * Trade date. Only the UTC year/month/day are used — any time-of-day component is
   * floored to UTC midnight, so a `Date` carrying a wall-clock time (e.g. from a
   * broker export) is treated as that calendar day. Must be on or after 2008-04-06.
   */
  date: Date;
  /** Trade type: "buy" (acquisition), "sell" (disposal), or "transfer" (no-gain/no-loss gift to spouse). */
  type: "buy" | "sell" | "transfer";
  /** Stock ticker symbol (e.g. "AAPL", "VOD.L"). Case-sensitive. */
  symbol: string;
  /** Number of shares traded. Must be positive. */
  quantity: number;
  /** Price per share in trade currency (converted to GBP via exchangeRate). */
  unitPrice: number;
  /** Fees/commission in trade currency. Adds to cost on buys, reduces proceeds on sells. Default: 0. */
  allowableExpenditure?: number;
  /** Exchange rate: units of trade currency per 1 GBP. Omit or set to 1 for GBP-denominated trades. */
  exchangeRate?: number;
}

/** A stock split event applied to all matching trades on or before its date. */
export interface CgSplitEvent {
  /** Date the split took effect. Only the UTC year/month/day are used (floored to UTC midnight). */
  date: Date;
  /** Stock ticker symbol the split applies to. */
  symbol: string;
  /** Original share count in the split ratio (e.g. 1 for a 1:20 split). */
  ratioFrom: number;
  /** New share count in the split ratio (e.g. 20 for a 1:20 split). */
  ratioTo: number;
}

/** Options for the calculateCgt function. */
export interface CgCalculateOptions {
  /** Stock split events used to adjust pre-split quantities. */
  splitEvents?: CgSplitEvent[];
}
