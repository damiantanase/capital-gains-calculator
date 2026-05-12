// Core calculation
export { calculateCgt } from "./calculator";
export type { CalculateCgtOptions } from "./calculator";
export type {
  Result,
  CgtResult,
  CgtDisposal,
  CgtMatch,
  CgtAcquisition,
  CgtTaxYearSummary,
  CgtRatePeriodSummary,
  Section104Pool,
  PoolImpact,
  NormalisedTransaction,
  SplitEvent,
} from "./types";

// Trade input
export type { CgtTradeInput } from "./trade";

// Optimiser
export { calculateOptimalSell, validateOptimiseParams } from "./optimiser";
export type { OptimiseParams, OptimiseResult, OptimalSellResult, OptimiseValidationError } from "./optimiser";

// Normalisation & validation
export { normaliseTrades } from "./normalise";
export type { ValidationError, NormaliseResult, NormaliseOptions } from "./normalise";

// HMRC config / helpers
export {
  getDefaultAllowances,
  getReportingThresholds,
  getAllTaxYears,
  getTaxYearConfig,
  getAllTaxYearConfigs,
  getRatesForDate,
} from "./hmrc-config";
export type { TaxYearConfig, CgtRateBand, CgtRatePeriod } from "./hmrc-config";
export { getTaxYearForDate, getCurrentTaxYear } from "./constants";
