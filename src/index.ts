// Core calculation
export { calculateCgt } from "./calculate.js";
export type { CgCalculateOptions } from "./calculate.js";

// Trade input type
export type { CgTradeInput } from "./trade.js";

// Errors
export { CgValidationError } from "./errors.js";
export type { CgValidationDetail } from "./errors.js";

// Public date utilities (UK tax-year helpers)
export { getTaxYearForDate, getCurrentTaxYear } from "./helpers.js";

// HMRC support info (supported date range, rates, and allowances — without a calculation)
export { getSupportInfo } from "./hmrc-config.js";

// Output types
export type {
  CgCalculateResult,
  CgEvent,
  CgMatch,
  CgTaxYearSummary,
  CgRatePeriodSummary,
  CgReportingReason,
  CgSection104Pool,
  CgPoolImpact,
  CgNormalisedTransaction,
  CgSplitEvent,
  CgTaxLimits,
  CgRatePeriod,
  CgTaxYearConfig,
  CgSupportInfo,
} from "./types/index.js";
