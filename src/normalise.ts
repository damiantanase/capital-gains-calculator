import type { SplitEvent, NormalisedTransaction, Result } from "./types";
import type { CgtTradeInput } from "./trade";
import { prepareTrades, TradeModel } from "./trade";
import { SHARE_TOLERANCE } from "./constants";


export interface ValidationError {
  index: number;
  field: string;
  message: string;
}

export interface NormaliseOptions {
  splitEvents?: SplitEvent[];
  /**
   * When true, invalid trades are removed and valid trades are still normalised.
   * Errors are returned alongside the valid transactions.
   * When false (default), any validation error returns an empty transactions array.
   */
  skipInvalid?: boolean;
}

export interface NormaliseResult {
  transactions: NormalisedTransaction[];
  errors: ValidationError[];
}

/**
 * Validate and normalise raw trade inputs into sorted, merged, GBP-denominated transactions.
 *
 * Returns a Result: check `result.ok` before accessing `result.data`.
 * When `skipInvalid` is true, invalid trades are removed and the remaining valid trades
 * are normalised — errors are still reported alongside the valid data.
 *
 * Validation checks:
 * - No trades before 2008/09 tax year (6 April 2008)
 * - Quantities must be positive
 * - Unit prices must be non-negative
 * - Fees must be non-negative
 * - Exchange rates must be positive (when provided)
 * - Cannot sell more shares than accumulated (per symbol, chronologically)
 *
 * Normalisation:
 * - Converts all values to GBP using the provided exchange rate (or 1 if omitted)
 * - Adjusts quantities for stock splits
 * - Merges same-day/same-symbol/same-type trades
 * - Sorts chronologically
 * - Includes split adjustment factor per transaction
 */
export function normaliseTrades(
  inputs: CgtTradeInput[],
  options?: NormaliseOptions
): Result<NormaliseResult, ValidationError> {
  const splitEvents = options?.splitEvents ?? [];
  const skipInvalid = options?.skipInvalid ?? false;

  const inputErrors = validateInputs(inputs);

  if (!skipInvalid && inputErrors.length > 0) {
    return { ok: false, errors: inputErrors };
  }

  const invalidIndices = new Set(inputErrors.map((e) => e.index));
  const validInputs = skipInvalid ? inputs.filter((_, i) => !invalidIndices.has(i)) : inputs;

  const positionErrors = validatePositions(validInputs, splitEvents, skipInvalid);

  if (!skipInvalid && positionErrors.length > 0) {
    return { ok: false, errors: positionErrors };
  }

  const allErrors = [...inputErrors, ...positionErrors];

  const tradesToNormalise = skipInvalid
    ? filterOutPositionErrors(validInputs, positionErrors)
    : validInputs;

  const prepared = prepareTrades(tradesToNormalise, splitEvents);
  const sorted = [...prepared].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.id - b.id;
  });
  const transactions = buildNormalisedTransactions(sorted);

  return { ok: true, data: { transactions, errors: allErrors } };
}

/** Build normalised transactions from sorted TradeModel instances. Shared by normaliseTrades and calculateCgt. */
export function buildNormalisedTransactions(sorted: TradeModel[]): NormalisedTransaction[] {
  const groups = new Map<string, TradeModel[]>();
  for (const t of sorted) {
    const key = `${t.date}|${t.symbol}|${t.type}`;
    if (!groups.has(key)) groups.set(key, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key guaranteed by has() check above
    groups.get(key)!.push(t);
  }

  const transactions: NormalisedTransaction[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const totalFees = group.reduce((s, t) => s + t.fees(), 0);
    const valueGBP = group.reduce((s, t) => s + t.value(), 0);

    transactions.push({
      date: first.date,
      symbol: first.symbol,
      type: first.type,
      quantity: group.reduce((s, t) => s + t.adjustedQuantity(), 0),
      originalQuantity: group.reduce((s, t) => s + t.quantity, 0),
      adjustmentFactor: first.adjustmentFactor,
      valueGBP,
      feesGBP: totalFees,
      mergedFrom: group.map(
        (t) => `${t.quantity} ${t.symbol} ${t.type} @ £${(t.unitPrice / t.exchangeRate).toFixed(2)}`
      ),
    });
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return transactions;
}

export function validateInputs(inputs: CgtTradeInput[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i];

    if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
      errors.push({ index: i, field: "date", message: "Date must be in YYYY-MM-DD format" });
      continue;
    }

    if (t.date < "2008-04-06") {
      errors.push({
        index: i,
        field: "date",
        message: "Trades before 6 April 2008 are not supported (pre-2008/09 tax year)",
      });
    }

    if (!t.type || !["buy", "sell", "transfer"].includes(t.type)) {
      errors.push({
        index: i,
        field: "type",
        message: "Type must be 'buy', 'sell', or 'transfer'",
      });
    }

    if (!t.symbol || t.symbol.trim() === "") {
      errors.push({ index: i, field: "symbol", message: "Symbol is required" });
    }

    if (t.quantity == null || t.quantity <= 0) {
      errors.push({ index: i, field: "quantity", message: "Quantity must be positive" });
    }

    if (t.unitPrice == null || t.unitPrice < 0) {
      errors.push({ index: i, field: "unitPrice", message: "Unit price must be non-negative" });
    }

    if (t.allowableExpenditure != null && t.allowableExpenditure < 0) {
      errors.push({
        index: i,
        field: "allowableExpenditure",
        message: "Fees/allowable expenditure must be non-negative",
      });
    }

    if (t.exchangeRate != null && t.exchangeRate <= 0) {
      errors.push({
        index: i,
        field: "exchangeRate",
        message: "Exchange rate must be positive",
      });
    }
  }

  return errors;
}

/**
 * Validates that sells don't exceed accumulated positions.
 * When skipInvalid is true, the returned errors reference indices within the validInputs array.
 * We store the originalIndex from the full input array for consistent error reporting.
 */
function validatePositions(
  inputs: CgtTradeInput[],
  splitEvents: SplitEvent[],
  skipInvalid: boolean
): ValidationError[] {
  const errors: ValidationError[] = [];

  const indexed = inputs.map((t, i) => ({ ...t, localIndex: i }));
  const sorted = [...indexed].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.localIndex - b.localIndex;
  });

  const positions = new Map<string, number>();

  for (const t of sorted) {
    const symbol = t.symbol;
    const current = positions.get(symbol) ?? 0;

    let adjustmentFactor = 1;
    for (const split of splitEvents) {
      if (split.symbol === symbol && split.date > t.date) {
        adjustmentFactor *= split.ratioTo / split.ratioFrom;
      }
    }

    const adjustedQty = t.quantity * adjustmentFactor;

    // Track running position per symbol to detect disposals that exceed available shares.
    // Buys increase the position; sells and transfers (out) decrease it.
    // In strict mode (!skipInvalid), we short-circuit on the first bad disposal because
    // subsequent position tracking becomes unreliable after a rejected transaction.
    if (t.type === "buy") {
      positions.set(symbol, current + adjustedQty);
    } else { // sell or transfer — check if position has enough shares
      if (adjustedQty > current + SHARE_TOLERANCE) {
        errors.push({
          index: t.localIndex,
          field: "quantity",
          message: `Cannot ${t.type === "sell" ? "sell" : "transfer"} ${t.quantity} ${symbol} — only ${(current / adjustmentFactor).toFixed(4)} shares available`,
        });
        if (!skipInvalid) return errors;
      } else {
        positions.set(symbol, current - adjustedQty);
      }
    }
  }

  return errors;
}

/**
 * Removes sells that would exceed available positions, keeping all buys/transfers
 * and only the valid sells.
 */
function filterOutPositionErrors(
  inputs: CgtTradeInput[],
  positionErrors: ValidationError[]
): CgtTradeInput[] {
  if (positionErrors.length === 0) return inputs;
  const invalidIndices = new Set(positionErrors.map((e) => e.index));
  return inputs.filter((_, i) => !invalidIndices.has(i));
}
