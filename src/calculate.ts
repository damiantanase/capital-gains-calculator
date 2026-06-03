import type { CgCalculateOptions, CgTradeInput, CgCalculateResult } from "./types/index.js";
import { assertValidInputs, assertValidPositions } from "./validate.js";
import { prepareTrades } from "./trade.js";
import { mergeTrades, toNormalisedTransactions } from "./normalise.js";
import { matchAndPool } from "./match.js";
import { toUtcMidnight } from "./utils.js";

export type { CgCalculateOptions } from "./types/index.js";

/**
 * Calculate UK Capital Gains Tax from raw trade inputs.
 *
 * Pipeline:
 *   1. validate input fields
 *   2. normalise every trade/split date to UTC midnight (only the calendar day matters)
 *   3. convert to TradeModel (sorted, split-adjusted)
 *   4. validate positions (no sell/transfer exceeds the position to that date)
 *   5. merge same-day/symbol/type trades
 *   6. run HMRC matching engine and tax-year summary
 *
 * @throws {CgValidationError} when inputs fail validation or a trade falls in an unsupported tax year
 */
export function calculateCgt(
  inputs: CgTradeInput[],
  options?: CgCalculateOptions
): CgCalculateResult {
  assertValidInputs(inputs);
  // Floor all dates to UTC midnight up front (fresh objects — the caller's inputs
  // are never mutated). Every downstream date comparison uses getTime(), so this is
  // what makes the "only year/month/day are used" contract hold for same-day
  // matching, the B&B window, split ordering, and rate-period boundaries.
  const normalisedInputs = inputs.map((t) => ({ ...t, date: toUtcMidnight(t.date) }));
  const splitEvents = (options?.splitEvents ?? []).map((s) => ({
    ...s,
    date: toUtcMidnight(s.date),
  }));
  const trades = prepareTrades(normalisedInputs, splitEvents);
  assertValidPositions(trades);
  const merged = mergeTrades(trades);
  const normalisedTransactions = toNormalisedTransactions(merged);
  const taxYears = matchAndPool(merged, splitEvents, normalisedTransactions);
  return { taxYears, normalisedTransactions };
}
