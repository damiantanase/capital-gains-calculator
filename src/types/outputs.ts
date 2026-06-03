// =============================================================================
// HMRC configuration
// =============================================================================

/** A date range with applicable CGT rates. */
export interface CgRatePeriod {
  /** Start date of this rate period (inclusive). */
  from: Date;
  /** End date of this rate period (inclusive). */
  to: Date;
  /** Basic rate taxpayer CGT percentage. */
  basicRate: number;
  /** Higher/additional rate taxpayer CGT percentage. */
  higherRate: number;
}

/** CGT tax limits for a single UK tax year. */
export interface CgTaxLimits {
  /** Annual Exempt Amount in GBP. */
  annualExemptAmount: number;
  /** Reporting threshold in GBP (4x AEA for most years). */
  reportingThreshold: number;
}

/** HMRC configuration for a single UK tax year. */
export interface CgTaxYearConfig {
  /** Tax year in "YYYY/YY" format (e.g. "2023/24"). */
  taxYear: string;
  /** Tax limits (AEA, reporting threshold) for this year. */
  limits: CgTaxLimits;
  /** Rate periods within this tax year (most have one; 2024/25 has two). */
  ratePeriods: CgRatePeriod[];
}

/**
 * The full set of HMRC data the library supports, plus the derived bounds a
 * consumer needs to validate input ahead of a calculation (e.g. to bound a
 * date-picker or look up a rate without running a calculation). Returned by
 * getSupportInfo(); every field is a fresh copy, safe to read and mutate.
 */
export interface CgSupportInfo {
  /**
   * Earliest trade date accepted by calculateCgt (the first day of the earliest
   * supported tax year).
   * @computed taxYears[0].ratePeriods[0].from
   */
  minDate: Date;
  /**
   * Latest trade date accepted by calculateCgt (the last day of the latest
   * supported tax year). Trades after this are rejected until the config is extended.
   * @computed taxYears[last].ratePeriods[last].to
   */
  maxDate: Date;
  /**
   * Earliest supported tax year in "YYYY/YY" format.
   * @computed taxYears[0].taxYear
   */
  earliestTaxYear: string;
  /**
   * Latest supported tax year in "YYYY/YY" format.
   * @computed taxYears[last].taxYear
   */
  latestTaxYear: string;
  /** Every supported tax year's config (limits + rate periods), ascending by year. */
  taxYears: CgTaxYearConfig[];
}

// =============================================================================
// Pool state
// =============================================================================

/** State of a Section 104 pool for a single symbol at a point in time. */
export interface CgSection104Pool {
  /** Stock ticker symbol. */
  symbol: string;
  /** Number of shares in the pool. */
  shares: number;
  /** Total cost basis in GBP. */
  costGBP: number;
}

/** Change to a symbol's Section 104 pool caused by an event. */
export interface CgPoolImpact {
  /** Net change in pool shares (post-split). Positive = added to the pool, negative = removed. */
  sharesDelta: number;
  /** Net change in pool cost basis in GBP. Positive = added, negative = removed. */
  costDeltaGBP: number;
}

// =============================================================================
// Normalised transactions
// =============================================================================

/** A merged, GBP-denominated transaction derived from one or more input trades. */
export interface CgNormalisedTransaction {
  /** Stable identifier for this transaction. Referenced by CgMatch.normalisedTradeId. */
  normalisedTradeId: number;
  /** Date of the transaction. */
  date: Date;
  /** Transaction type. */
  type: "buy" | "sell" | "transfer";
  /** Stock ticker symbol. */
  symbol: string;
  /** Pre-split quantity, as entered (multiply by splitFactor for the post-split count). */
  originalQuantity: number;
  /** Cumulative split factor: product of (ratioTo/ratioFrom) for all splits after the trade date. */
  splitFactor: number;
  /**
   * Split-adjusted share count.
   * @computed originalQuantity * splitFactor
   */
  quantity: number;
  /** Total value in GBP. For buys: cost including fees. For sells: net proceeds (gross minus fees). For transfers: 0. */
  valueGBP: number;
  /** Fees/commission converted to GBP. Always 0 for transfers. */
  feesGBP: number;
  /** Indices in the original inputs array of the trades merged into this transaction. */
  inputIndices: number[];
}

// =============================================================================
// Matching and events
// =============================================================================

/** A single match showing which HMRC rule was applied and how many shares were matched. */
export interface CgMatch {
  /** Which HMRC matching rule was applied. */
  rule: "same-day" | "bed-and-breakfast" | "section-104";
  /** Pre-split quantity matched. Multiply by the event's splitFactor for the post-split count. */
  originalMatchedQuantity: number;
  /** normalisedTradeId of the matched counterparty in CgCalculateResult.normalisedTransactions. Absent for section-104. */
  normalisedTradeId?: number;
  /**
   * Allowable cost in GBP attributed to this match. For section-104 matches: the pool's
   * weighted-average cost for the matched shares. For same-day/B&B matches: the matched
   * counterparty trade's cost per share times the matched shares.
   * @computed section-104: (poolBefore.costGBP / poolBefore.shares) * originalMatchedQuantity * splitFactor; same-day/B&B: (counterparty.valueGBP / counterparty.quantity) * originalMatchedQuantity * splitFactor
   */
  costGBP: number;
  /**
   * Gain in GBP for this match. Non-zero only on sell events (0 for buys and transfers).
   * @computed sells: originalMatchedQuantity * splitFactor * (event.valueGBP / event.quantity) - costGBP; otherwise 0
   */
  gainGBP: number;
  /**
   * Date of the matched counterparty transaction. Undefined for section-104 matches (no counterparty).
   * @computed transactions.find(t => t.normalisedTradeId === normalisedTradeId)?.date
   */
  matchedDate?: Date;
}

/** A CGT event (buy, sell, or transfer) produced by the calculation. */
export interface CgEvent {
  /** Date of the event. */
  date: Date;
  /** Event type. */
  type: "buy" | "sell" | "transfer";
  /** Stock ticker symbol. */
  symbol: string;
  /** Pre-split quantity, as entered (multiply by splitFactor for the post-split count). */
  originalQuantity: number;
  /** Cumulative split factor: product of (ratioTo/ratioFrom) for all splits after the trade date. */
  splitFactor: number;
  /**
   * Split-adjusted share count.
   * @computed originalQuantity * splitFactor
   */
  quantity: number;
  /** Total value in GBP. For buys: cost including fees. For sells: net proceeds. For transfers: 0. */
  valueGBP: number;
  /** Fees/commission in GBP (the trade's allowableExpenditure, FX-converted). Present for buys, sells, and transfers. Does not affect a transfer's gain, which is always 0. */
  feesGBP: number;
  /** Matching breakdown — cost source for sells/transfers, destination for buys. */
  matches: CgMatch[];
  /**
   * Total allowable cost in GBP across all matches.
   * @computed Σ matches[].costGBP
   */
  costGBP: number;
  /**
   * Gain in GBP for this event. Non-zero only on sell events (0 for buys and transfers).
   * @computed sells: matchedShares * (valueGBP / quantity) - costGBP; otherwise 0
   */
  gainGBP: number;
  /** Section 104 pool state immediately before this event. */
  poolBefore: CgSection104Pool[];
  /** Section 104 pool state immediately after this event. */
  poolAfter: CgSection104Pool[];
  /**
   * Change this event made to its symbol's Section 104 pool, or null if there was no change.
   * @computed poolAfter − poolBefore for this symbol; null when both deltas are within tolerance
   */
  poolImpact: CgPoolImpact | null;
}

// =============================================================================
// Tax year summaries
// =============================================================================

/** Summary for a single rate period within a tax year. */
export interface CgRatePeriodSummary {
  /** The rate period this summary covers (dates and rates). */
  period: CgRatePeriod;
  /** Portion of the year's Annual Exempt Amount (plus any cross-period loss relief) allocated to this period. Allocated to the highest-rate period first per HMRC's most-beneficial-to-the-taxpayer rule (CG21520). The period's taxable gain is its net gain minus this. */
  allocatedAEA: number;
  /** All events (buys, sells, transfers) that fall within this rate period. */
  events: CgEvent[];
  /**
   * Total disposal proceeds in GBP.
   * @computed Σ sells.valueGBP
   */
  proceedsGBP: number;
  /**
   * Total allowable costs in GBP.
   * @computed Σ sells.costGBP
   */
  costsGBP: number;
  /**
   * Total fees/commissions in GBP across ALL events in the period (buys, sells, and transfers).
   * Display figure — already reflected in costsGBP/proceeds via the per-trade cost basis.
   * @computed Σ events[].feesGBP
   */
  feesGBP: number;
  /**
   * Sum of positive gains in GBP.
   * @computed Σ sells where gainGBP > 0
   */
  gainsGBP: number;
  /**
   * Sum of losses (negative number) in GBP.
   * @computed Σ sells where gainGBP < 0
   */
  lossesGBP: number;
  /**
   * Net gain after offsetting losses in GBP.
   * @computed gainsGBP + lossesGBP
   */
  netGainGBP: number;
  /**
   * Gain subject to tax after the allocated AEA deduction, in GBP.
   * @computed max(0, netGainGBP - allocatedAEA)
   */
  taxableGainGBP: number;
  /**
   * Tax due in GBP at the basic rate.
   * @computed taxableGainGBP * (period.basicRate / 100)
   */
  taxBasicGBP: number;
  /**
   * Tax due in GBP at the higher rate.
   * @computed taxableGainGBP * (period.higherRate / 100)
   */
  taxHigherGBP: number;
  /**
   * Number of disposal events (HMRC disposals: sells AND transfers — a transfer is a
   * no-gain/no-loss disposal that still reduces the position). NOT sells-only.
   * @computed events.filter(e => e.type === "sell" || e.type === "transfer").length
   */
  disposalCount: number;
  /**
   * Number of acquisition events (buys).
   * @computed events.filter(e => e.type === "buy").length
   */
  acquisitionCount: number;
}

/** Why a tax year requires CGT reporting (semantic codes; the consumer maps these to display text). */
export type CgReportingReason = "taxable-gain" | "proceeds-exceed-threshold";

/** Summary for a complete UK tax year (6 April to 5 April). */
export interface CgTaxYearSummary {
  /** Tax year in "YYYY/YY" format (e.g. "2023/24"). */
  taxYear: string;
  /** Tax limits (AEA, reporting threshold) for this year. */
  limits: CgTaxLimits;
  /** Breakdown by rate period (most years have one; 2024/25 has two). */
  periods: CgRatePeriodSummary[];
  /** Section 104 pool state at the end of this tax year. */
  poolAtYearEnd: CgSection104Pool[];
  /**
   * Total disposal proceeds in GBP.
   * @computed Σ periods[].proceedsGBP
   */
  proceedsGBP: number;
  /**
   * Total allowable costs in GBP.
   * @computed Σ periods[].costsGBP
   */
  costsGBP: number;
  /**
   * Total fees/commissions in GBP across the year (buys, sells, and transfers).
   * Display figure — already reflected in costsGBP/proceeds via the per-trade cost basis.
   * @computed Σ periods[].feesGBP
   */
  feesGBP: number;
  /**
   * Sum of positive gains in GBP.
   * @computed Σ periods[].gainsGBP
   */
  gainsGBP: number;
  /**
   * Sum of losses (negative number) in GBP.
   * @computed Σ periods[].lossesGBP
   */
  lossesGBP: number;
  /**
   * Net gain after offsetting in-year losses, in GBP.
   * @computed gainsGBP + lossesGBP
   */
  netGainGBP: number;
  /**
   * Gain subject to tax after the AEA deduction, in GBP.
   * @computed max(0, netGainGBP - limits.annualExemptAmount)
   */
  taxableGainGBP: number;
  /**
   * Tax due in GBP at the basic rate (summed across rate periods).
   * @computed Σ periods[].taxBasicGBP
   */
  taxBasicGBP: number;
  /**
   * Tax due in GBP at the higher rate (summed across rate periods).
   * @computed Σ periods[].taxHigherGBP
   */
  taxHigherGBP: number;
  /**
   * Number of disposal events (HMRC disposals: sells AND transfers). NOT sells-only.
   * @computed Σ periods[].disposalCount
   */
  disposalCount: number;
  /**
   * Number of acquisition events (buys).
   * @computed Σ periods[].acquisitionCount
   */
  acquisitionCount: number;
  /**
   * Whether this tax year must be reported to HMRC.
   * @computed taxableGainGBP > 0 || proceedsGBP > limits.reportingThreshold
   */
  reportingRequired: boolean;
  /**
   * The reasons reportingRequired is true (empty when false). Semantic codes; map to display text.
   * @computed ["taxable-gain"] when taxableGainGBP > 0, ["proceeds-exceed-threshold"] when proceedsGBP > limits.reportingThreshold (both when both)
   */
  reportingReasons: CgReportingReason[];
  /**
   * Annual Exempt Amount still available in GBP after offsetting the year's net gain,
   * capped at the statutory AEA.
   * @computed max(0, limits.annualExemptAmount - max(0, netGainGBP))
   */
  remainingAEAGBP: number;
}

// =============================================================================
// Calculator result
// =============================================================================

/** The complete result of a CGT calculation. */
export interface CgCalculateResult {
  /** Per-tax-year summaries, sorted most recent first. */
  taxYears: CgTaxYearSummary[];
  /** The normalised, merged, sorted transactions. Referenced by CgMatch.normalisedTradeId. */
  normalisedTransactions: CgNormalisedTransaction[];
}
