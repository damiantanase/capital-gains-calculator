import type { CgTradeInput } from "./types/index.js";
import { SHARE_TOLERANCE } from "./utils.js";
import type { TradeModel } from "./trade.js";
import { CgValidationError, type CgValidationDetail } from "./errors.js";
import { getTaxYearForDate } from "./helpers.js";
import { getEarliestSupportedTaxYear, getLatestSupportedTaxYear } from "./hmrc-config.js";

const EARLIEST_TAX_YEAR = getEarliestSupportedTaxYear();
const LATEST_TAX_YEAR = getLatestSupportedTaxYear();

/**
 * Validates raw trade inputs (field-level checks).
 *
 * Checks:
 * - No trades before the earliest supported tax year (from the HMRC config)
 * - No trades past the latest supported tax year (from the HMRC config)
 * - Quantities must be positive
 * - Unit prices must be non-negative
 * - Fees must be non-negative
 * - Exchange rates must be positive (when provided)
 *
 * Throws CgValidationError if any are invalid.
 */
export function validateInputs(inputs: CgTradeInput[]): CgValidationDetail[] {
  const errors: CgValidationDetail[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i];

    if (!t.date || !(t.date instanceof Date) || isNaN(t.date.getTime())) {
      errors.push({ index: i, field: "date", message: "Date must be a valid Date object" });
      continue;
    }

    // "YYYY/YY" tax-year strings sort chronologically as plain strings, so both
    // the lower and upper bound are a string comparison against the config range.
    const taxYear = getTaxYearForDate(t.date);
    if (taxYear < EARLIEST_TAX_YEAR) {
      errors.push({
        index: i,
        field: "date",
        message: `Trades in tax year ${taxYear} are not supported; the earliest supported tax year is ${EARLIEST_TAX_YEAR}`,
      });
    } else if (taxYear > LATEST_TAX_YEAR) {
      errors.push({
        index: i,
        field: "date",
        message: `Trades in tax year ${taxYear} are not supported; the latest supported tax year is ${LATEST_TAX_YEAR}`,
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
 * Validates that no sell/transfer exceeds the position accumulated up to its date.
 *
 * Trades are expected to be sorted by date (with input-order ties), as produced
 * by prepareTrades. Quantities are taken from getQuantity() — already split-adjusted.
 *
 * The B&B rule is a tax-matching concept; it does not let you physically sell
 * shares you do not yet own.
 */
export function validatePositions(trades: TradeModel[]): CgValidationDetail[] {
  const positions = new Map<string, number>();

  for (const t of trades) {
    const current = positions.get(t.symbol) ?? 0;
    const adjustedQty = t.getQuantity();

    if (t.type === "buy") {
      positions.set(t.symbol, current + adjustedQty);
    } else {
      if (adjustedQty > current + SHARE_TOLERANCE) {
        return [
          {
            index: t.inputIndices[0],
            field: "quantity",
            message: `Cannot ${t.type === "sell" ? "sell" : "transfer"} ${t.originalQuantity} ${t.symbol} — only ${(current / t.splitFactor).toFixed(4)} shares available`,
          },
        ];
      }
      positions.set(t.symbol, current - adjustedQty);
    }
  }

  return [];
}

/** Throws CgValidationError if validateInputs returns any errors. */
export function assertValidInputs(inputs: CgTradeInput[]): void {
  const errors = validateInputs(inputs);
  if (errors.length > 0) throw new CgValidationError(errors);
}

/** Throws CgValidationError if validatePositions returns any errors. */
export function assertValidPositions(trades: TradeModel[]): void {
  const errors = validatePositions(trades);
  if (errors.length > 0) throw new CgValidationError(errors);
}
