// =============================================================================
// Internal utilities
//
// Pure, dependency-free helpers used only inside the engine. Nothing here is
// re-exported from index.ts — these are NOT part of the public API. The engine
// uses the derivation functions below to bake computed values (cost, gain, pool
// impact, period/year aggregates) onto the output types, so consumers read fields
// rather than calling helpers. Public, consumer-facing date utilities (the
// UK tax-year helpers) live in helpers.ts.
// =============================================================================

import type {
  CgEvent,
  CgNormalisedTransaction,
  CgPoolImpact,
  CgSection104Pool,
} from "./types/index.js";

/** The match fields needed to derive per-match cost — satisfied by both the engine's working match and CgMatch. */
interface MatchCore {
  rule: "same-day" | "bed-and-breakfast" | "section-104";
  originalMatchedQuantity: number;
  normalisedTradeId?: number;
}

/** A match whose per-match cost has already been derived (used to aggregate an event's totals). */
interface CostedMatch {
  originalMatchedQuantity: number;
  costGBP: number;
}

/** Tolerance for floating-point comparison of share quantities. Avoids false positives from rounding after split adjustments. */
export const SHARE_TOLERANCE = 0.0001;

/** Money amounts below this (in GBP) are treated as zero when detecting pool changes. */
export const MONEY_TOLERANCE_GBP = 0.01;

/** Returns true if the share count is effectively zero (within SHARE_TOLERANCE). */
export function isZeroShares(shares: number): boolean {
  return shares <= SHARE_TOLERANCE;
}

/**
 * Narrow away `undefined` for a value an internal invariant guarantees is present.
 * Throws (rather than silently coercing) if the invariant is ever violated, so a
 * logic regression surfaces loudly instead of producing a wrong tax figure.
 */
export function assertDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(`Internal invariant violated: ${message}`);
  return value;
}

/** Whole days from dateA to dateB (positive when dateB is later). Used for the 30-day B&B window. */
export function daysBetween(dateA: Date, dateB: Date): number {
  return Math.round((dateB.getTime() - dateA.getTime()) / 86_400_000);
}

/**
 * Floor a Date to UTC midnight on its calendar day, discarding any time-of-day
 * component. The public contract is that only an input date's UTC year/month/day
 * matter (see CgTradeInput.date); normalising once at the boundary makes that true
 * for every downstream comparison that uses getTime() — same-day equality, the B&B
 * day window (daysBetween), split-date ordering, and rate-period boundaries — which
 * would otherwise be skewed by a non-midnight timestamp.
 */
export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Format a Date to YYYY-MM-DD string using UTC components. Internal merge-key helper. */
export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// =============================================================================
// Derivation formulas
//
// These compute the values baked onto CgMatch / CgEvent / CgRatePeriodSummary /
// CgTaxYearSummary. They are the single source of truth for cost/gain/tax maths,
// used by the engine (match.ts) at calculation time. Each output-type field's
// JSDoc @computed tag documents the formula these implement.
// =============================================================================

/** Context an event provides to its match-level derivations. */
export interface EventDeriveContext {
  type: "buy" | "sell" | "transfer";
  symbol: string;
  splitFactor: number;
  /** Split-adjusted quantity (originalQuantity * splitFactor). */
  quantity: number;
  valueGBP: number;
  poolBefore: CgSection104Pool[];
}

/** Allowable cost in GBP for a single match (section-104 pool cost or counterparty cost). */
export function deriveMatchCostGBP(
  match: MatchCore,
  ctx: EventDeriveContext,
  transactions: CgNormalisedTransaction[]
): number {
  if (match.rule === "section-104") {
    const pool = ctx.poolBefore.find((p) => p.symbol === ctx.symbol);
    if (!pool || pool.shares === 0) return 0;
    // poolBefore is de-adjusted to real (as-of-disposal-date) shares, and
    // originalMatchedQuantity is on that same as-of-date basis, so the pool's
    // cost-per-share already reconciles directly. (Unlike the same-day/B&B
    // branch below, whose counterparty cost-per-share is per split-adjusted
    // share and therefore needs the ctx.splitFactor scaling.) Multiplying by
    // ctx.splitFactor here would over-scale the cost by the factor of any split
    // dated after the disposal.
    const costPerShare = pool.costGBP / pool.shares;
    return costPerShare * match.originalMatchedQuantity;
  }
  // Same-day/B&B matches always carry a counterparty normalisedTradeId.
  const tx = assertDefined(
    transactions.find((t) => t.normalisedTradeId === match.normalisedTradeId),
    `counterparty transaction ${match.normalisedTradeId} for ${match.rule} match`
  );
  const txAdjQty = tx.originalQuantity * tx.splitFactor;
  const costPerShare = tx.valueGBP / txAdjQty;
  return costPerShare * match.originalMatchedQuantity * ctx.splitFactor;
}

/** Gain in GBP for a single match. Non-zero only for sells. */
export function deriveMatchGainGBP(
  match: MatchCore,
  ctx: EventDeriveContext,
  cost: number
): number {
  if (ctx.type !== "sell") return 0;
  const matchQty = match.originalMatchedQuantity * ctx.splitFactor;
  const proceedsPerShare = ctx.valueGBP / ctx.quantity;
  return matchQty * proceedsPerShare - cost;
}

/** Date of the matched counterparty transaction, or undefined for section-104. */
export function deriveMatchedDate(
  match: MatchCore,
  transactions: CgNormalisedTransaction[]
): Date | undefined {
  if (match.normalisedTradeId == null) return undefined;
  return transactions.find((t) => t.normalisedTradeId === match.normalisedTradeId)?.date;
}

/** Total allowable cost in GBP across already-costed matches. */
export function deriveEventCostGBP(matches: CostedMatch[]): number {
  return matches.reduce((sum, m) => sum + m.costGBP, 0);
}

/** Gain in GBP for an event (proceeds minus cost). 0 for buys/transfers. */
export function deriveEventGainGBP(
  ctx: EventDeriveContext,
  matches: CostedMatch[],
  totalCost: number
): number {
  if (ctx.type !== "sell") return 0;
  const matchedQty = matches.reduce(
    (sum, m) => sum + m.originalMatchedQuantity * ctx.splitFactor,
    0
  );
  /* istanbul ignore next -- validation prevents sells with no matching shares */
  if (matchedQty === 0) return 0;
  const proceedsPerShare = ctx.valueGBP / ctx.quantity;
  return matchedQty * proceedsPerShare - totalCost;
}

/** Change an event made to its symbol's Section 104 pool, or null if no change. */
export function derivePoolImpact(
  poolBefore: CgSection104Pool[],
  poolAfter: CgSection104Pool[],
  symbol: string
): CgPoolImpact | null {
  const before = poolBefore.find((p) => p.symbol === symbol);
  const after = poolAfter.find((p) => p.symbol === symbol);
  const sharesBefore = before?.shares ?? 0;
  const costBefore = before?.costGBP ?? 0;
  const sharesAfter = after?.shares ?? 0;
  const costAfter = after?.costGBP ?? 0;
  const sharesDelta = sharesAfter - sharesBefore;
  const costDeltaGBP = costAfter - costBefore;
  if (Math.abs(sharesDelta) < SHARE_TOLERANCE && Math.abs(costDeltaGBP) < MONEY_TOLERANCE_GBP)
    return null;
  return { sharesDelta, costDeltaGBP };
}

// --- Period / tax-year aggregates (computed from baked event fields) ---

/** Sum of net gain (positive and negative) across an event list's sells. */
export function sumNetGain(events: CgEvent[]): number {
  return events.filter((e) => e.type === "sell").reduce((sum, e) => sum + e.gainGBP, 0);
}

/** Total disposal proceeds in GBP. */
export function sumProceeds(events: CgEvent[]): number {
  return events.filter((e) => e.type === "sell").reduce((sum, e) => sum + e.valueGBP, 0);
}

/** Total allowable costs in GBP across sells. */
export function sumCosts(events: CgEvent[]): number {
  return events.filter((e) => e.type === "sell").reduce((sum, e) => sum + e.costGBP, 0);
}

/**
 * Total fees/commissions in GBP across all events (buys, sells, and transfers).
 * Deliberately not sell-only: this is a "total commissions paid" display figure.
 */
export function sumFees(events: CgEvent[]): number {
  return events.reduce((sum, e) => sum + e.feesGBP, 0);
}

/** Sum of positive gains in GBP. */
export function sumGains(events: CgEvent[]): number {
  return events
    .filter((e) => e.type === "sell")
    .filter((e) => e.gainGBP > 0)
    .reduce((sum, e) => sum + e.gainGBP, 0);
}

/** Sum of losses (negative number) in GBP. */
export function sumLosses(events: CgEvent[]): number {
  return events
    .filter((e) => e.type === "sell")
    .filter((e) => e.gainGBP < 0)
    .reduce((sum, e) => sum + e.gainGBP, 0);
}

/** Number of disposal events (sells and transfers). */
export function countDisposals(events: CgEvent[]): number {
  return events.filter((e) => e.type === "sell" || e.type === "transfer").length;
}

/** Number of acquisition events (buys). */
export function countAcquisitions(events: CgEvent[]): number {
  return events.filter((e) => e.type === "buy").length;
}
