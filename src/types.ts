import type { CgtRateBand } from "./hmrc-config";

/** Discriminated union result type. Check `ok` before accessing `data` or `errors`. */
export type Result<T, E> = { ok: true; data: T } | { ok: false; errors: E[] };

/** A single match within a disposal, showing which rule was applied and the cost/gain. */
export interface CgtMatch {
  /** Which HMRC matching rule was applied. */
  rule: "same-day" | "bed-and-breakfast" | "section-104";
  /** Number of shares matched (split-adjusted). */
  quantity: number;
  /** Original (pre-split) quantity for display. */
  originalQuantity: number;
  /** Cost per share in GBP for this match. */
  costPerShareGBP: number;
  /** Total cost in GBP for this match. */
  costGBP: number;
  /** Gain (or loss if negative) in GBP for this match. */
  gainGBP: number;
  /** IDs of buy trades matched against (same-day and B&B only). */
  matchedTradeIds?: number[];
  /** Date of the matched acquisition (same-day and B&B only). */
  matchedDate?: string;
  /** For section-104: total pool shares at time of match (adjusted). */
  poolSharesAtMatch?: number;
  /** For section-104: original (pre-split) pool shares at time of match. */
  originalPoolSharesAtMatch?: number;
  /** For same-day: original (pre-split) composited buy shares. */
  originalCompositeBuyShares?: number;
}

/** A disposal event (sale or transfer out of shares). */
export interface CgtDisposal {
  /** Whether this is a market sale or a no-gain/no-loss transfer. */
  type: "disposal" | "transfer";
  /** ID of the original trade input. */
  tradeId: number;
  date: string;
  symbol: string;
  /** Number of shares disposed (split-adjusted). */
  quantity: number;
  /** Original (pre-split) quantity. */
  originalQuantity: number;
  /** Gross price per share in GBP (before fees). */
  pricePerShareGBP: number;
  /** Original (pre-split) price per share in GBP. */
  originalPricePerShareGBP: number;
  /** Split adjustment factor at the time of disposal. */
  adjustmentFactor: number;
  /** Transaction fees in GBP. */
  feesGBP: number;
  /** Net proceeds in GBP (after fees). */
  proceedsGBP: number;
  /** Total allowable cost in GBP. */
  totalCostGBP: number;
  /** Gain or loss in GBP (proceeds - cost). */
  gainGBP: number;
  /** Breakdown of how shares were matched to acquisitions. */
  matches: CgtMatch[];
  /** What changed in the Section 104 pool, or null if pool was unaffected. */
  poolImpact: PoolImpact | null;
  /** Full pool state before this disposal. */
  poolStateBefore: Section104Pool[];
  /** Full pool state after this disposal. */
  poolStateAfter: Section104Pool[];
}

/** A stock split event (input). */
export interface SplitEvent {
  /** Date the split took effect (YYYY-MM-DD). */
  date: string;
  symbol: string;
  /** Original share count (e.g. 1 for a 1:20 split). */
  ratioFrom: number;
  /** New share count (e.g. 20 for a 1:20 split). */
  ratioTo: number;
}

/** State of a Section 104 pool for a single symbol. */
export interface Section104Pool {
  symbol: string;
  /** Number of shares in the pool (split-adjusted). */
  shares: number;
  /** Original (pre-split) share count. */
  originalShares: number;
  /** Total cost basis in GBP. */
  costGBP: number;
}

/** Describes what changed in the pool as a result of an event. Null means pool was unaffected. */
export interface PoolImpact {
  symbol: string;
  /** Shares added to pool (acquisitions). */
  sharesAdded?: number;
  /** Shares removed from pool (disposals). */
  sharesRemoved?: number;
  /** Cost basis added in GBP. */
  costAdded?: number;
  /** Cost basis removed in GBP. */
  costRemoved?: number;
}

/** Summary of gains/losses/tax for a single rate period within a tax year. */
export interface CgtRatePeriodSummary {
  /** Start date of this rate period (YYYY-MM-DD). */
  from: string;
  /** End date of this rate period (YYYY-MM-DD). */
  to: string;
  /** CGT rates applicable during this period (percentage). */
  rates: CgtRateBand;
  totalProceeds: number;
  totalCosts: number;
  totalGains: number;
  /** Total losses (negative number). */
  totalLosses: number;
  /** Net gain after offsetting losses. */
  netGainLoss: number;
  /** Gain subject to tax after AEA deduction. */
  taxableGain: number;
  /** Tax due at basic rate (taxableGain * basic rate). */
  taxBasicRate: number;
  /** Tax due at higher rate (taxableGain * higher rate). */
  taxHigherRate: number;
  disposalCount: number;
  disposals: CgtDisposal[];
}

/** Summary for a complete UK tax year (April 6 to April 5). */
export interface CgtTaxYearSummary {
  /** Tax year in "YYYY/YY" format (e.g. "2023/24"). */
  taxYear: string;
  /** HMRC Annual Exempt Amount for this tax year. */
  annualExemptAmount: number;
  totalProceeds: number;
  totalCosts: number;
  totalGains: number;
  /** Total losses (negative number). */
  totalLosses: number;
  /** Net gain after offsetting in-year losses. */
  netGainLoss: number;
  /** Gain subject to tax after AEA deduction. */
  taxableGain: number;
  /** Total tax at basic rate across all periods. */
  taxBasicRate: number;
  /** Total tax at higher rate across all periods. */
  taxHigherRate: number;
  disposalCount: number;
  /** All disposals and transfers in this tax year. */
  disposals: CgtDisposal[];
  /** All acquisitions in this tax year. */
  acquisitions: CgtAcquisition[];
  /** Breakdown by rate period (most years have one; 2024/25 has two). */
  periods: CgtRatePeriodSummary[];
}

/** An acquisition event (purchase of shares). */
export interface CgtAcquisition {
  /** ID of the original trade input. */
  tradeId: number;
  date: string;
  symbol: string;
  /** Number of shares acquired (split-adjusted). */
  quantity: number;
  /** Original (pre-split) quantity. */
  originalQuantity: number;
  /** Total cost in GBP (price + fees). */
  costGBP: number;
  /** How these shares were consumed (by pool, same-day match, or B&B match). */
  dispositions: {
    rule: "pool" | "same-day" | "bed-and-breakfast";
    quantity: number;
    originalQuantity: number;
    matchedDate?: string;
  }[];
  /** What changed in the pool, or null if shares were fully consumed by same-day/B&B. */
  poolImpact: PoolImpact | null;
  /** Full pool state before this acquisition. */
  poolStateBefore: Section104Pool[];
  /** Full pool state after this acquisition. */
  poolStateAfter: Section104Pool[];
}

/** A normalised, merged, GBP-denominated transaction. */
export interface NormalisedTransaction {
  date: string;
  symbol: string;
  type: "buy" | "sell" | "transfer";
  /** Quantity adjusted for subsequent stock splits. */
  quantity: number;
  /** Original quantity as entered (pre-split). */
  originalQuantity: number;
  /** Cumulative adjustment factor applied (product of all subsequent split ratios). */
  adjustmentFactor: number;
  /** Total value in GBP (proceeds for sells, cost for buys — includes fees for buys, excludes for sells). */
  valueGBP: number;
  /** Fees/commission converted to GBP. */
  feesGBP: number;
  /** Description of individual trades merged into this normalised transaction. */
  mergedFrom: string[];
}

/** The complete result of a CGT calculation. */
export interface CgtResult {
  /** Per-tax-year summaries, sorted most recent first. */
  taxYears: CgtTaxYearSummary[];
  /** Current Section 104 pool state (after all trades processed). */
  pools: Section104Pool[];
  /** Pool state at end of each tax year, keyed by tax year string (e.g. "2023/24"). */
  poolSnapshots: Record<string, Section104Pool[]>;
  /** Split events that were applied (passthrough from input). */
  splitEvents: SplitEvent[];
  /** All trades normalised into merged, sorted, GBP-denominated transactions. */
  normalisedTrades: NormalisedTransaction[];
}
