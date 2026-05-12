import type { Result } from "./types";

export interface OptimiseParams {
  symbol: string;
  currentPrice: number;
  exchangeRate: number;
  poolCostPerShare: number;
  poolShares: number;
  remainingAEA: number;
  /** Whether fractional/split shares are allowed. Default: false (whole shares only). */
  allowFractional?: boolean;
  /** How close to the AEA the result must be (as a decimal, e.g. 0.05 = within 5%). Default: 0.05. */
  tolerance?: number;
}

export interface OptimiseValidationError {
  field: string;
  message: string;
}

export interface OptimiseResult {
  status: "success" | "partial" | "loss" | "impossible";
  quantity: number;
  expectedGain: number;
  proceedsGBP: number;
  aeaUsed: number;
  aeaRemaining: number;
  /** Present when status is "partial" — explains why full AEA usage wasn't achieved. */
  reason?: string;
  /** Present when status is "loss" — the symbol would realise a loss, not a gain. */
  lossPerShare?: number;
}

export function validateOptimiseParams(params: OptimiseParams): OptimiseValidationError[] {
  const errors: OptimiseValidationError[] = [];

  if (!params.symbol || params.symbol.trim() === "") {
    errors.push({ field: "symbol", message: "Symbol is required" });
  }
  if (params.currentPrice == null || params.currentPrice < 0) {
    errors.push({ field: "currentPrice", message: "Current price must be non-negative" });
  }
  if (params.exchangeRate == null || params.exchangeRate <= 0) {
    errors.push({ field: "exchangeRate", message: "Exchange rate must be positive" });
  }
  if (params.poolCostPerShare == null || params.poolCostPerShare < 0) {
    errors.push({ field: "poolCostPerShare", message: "Pool cost per share must be non-negative" });
  }
  if (params.poolShares == null || params.poolShares <= 0) {
    errors.push({ field: "poolShares", message: "Pool shares must be positive" });
  }
  if (params.remainingAEA == null || params.remainingAEA <= 0) {
    errors.push({ field: "remainingAEA", message: "Remaining AEA must be positive" });
  }
  if (params.tolerance != null && (params.tolerance < 0 || params.tolerance > 1)) {
    errors.push({ field: "tolerance", message: "Tolerance must be between 0 and 1" });
  }

  return errors;
}

export type OptimalSellResult = Result<OptimiseResult, OptimiseValidationError>;

export function calculateOptimalSell(params: OptimiseParams): OptimalSellResult {
  const errors = validateOptimiseParams(params);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const { currentPrice, exchangeRate, poolCostPerShare, poolShares, remainingAEA } = params;
  const allowFractional = params.allowFractional ?? false;
  const tolerance = params.tolerance ?? 0.05;

  const proceedsPerShareGBP = currentPrice / exchangeRate;
  const gainPerShare = proceedsPerShareGBP - poolCostPerShare;

  // Stock would realise a loss — notify the consumer
  if (gainPerShare <= 0) {
    return {
      ok: true,
      data: {
        status: "loss",
        quantity: 0,
        expectedGain: 0,
        proceedsGBP: 0,
        aeaUsed: 0,
        aeaRemaining: remainingAEA,
        lossPerShare: gainPerShare,
      },
    };
  }

  // Calculate ideal quantity to fill the AEA
  const idealQuantity = remainingAEA / gainPerShare;
  const maxQuantity = poolShares;

  let quantity: number;
  if (allowFractional) {
    quantity = Math.min(idealQuantity, maxQuantity);
  } else {
    quantity = Math.min(Math.floor(idealQuantity), Math.floor(maxQuantity));
  }

  if (quantity <= 0) {
    return {
      ok: true,
      data: {
        status: "impossible",
        quantity: 0,
        expectedGain: 0,
        proceedsGBP: 0,
        aeaUsed: 0,
        aeaRemaining: remainingAEA,
        reason: `Gain per share (£${gainPerShare.toFixed(2)}) is too small to use any AEA with available shares`,
      },
    };
  }

  const expectedGain = quantity * gainPerShare;
  const aeaUsed = expectedGain;
  const aeaRemaining = remainingAEA - aeaUsed;
  const utilizationRatio = aeaUsed / remainingAEA;

  // Determine if we achieved close enough to the target
  const withinTolerance = utilizationRatio >= 1 - tolerance;

  let status: OptimiseResult["status"];
  let reason: string | undefined;

  if (withinTolerance) {
    status = "success";
  } else {
    status = "partial";
    if (quantity >= maxQuantity) {
      reason = `Not enough shares — selling all ${allowFractional ? maxQuantity.toFixed(4) : Math.floor(maxQuantity)} shares uses £${aeaUsed.toFixed(2)} of £${remainingAEA.toFixed(2)} AEA (${(utilizationRatio * 100).toFixed(1)}%)`;
    } else {
      reason = `Whole shares constraint — closest achievable is £${aeaUsed.toFixed(2)} of £${remainingAEA.toFixed(2)} AEA (${(utilizationRatio * 100).toFixed(1)}%)`;
    }
  }

  return {
    ok: true,
    data: {
      status,
      quantity,
      expectedGain,
      proceedsGBP: quantity * proceedsPerShareGBP,
      aeaUsed,
      aeaRemaining,
      reason,
    },
  };
}
