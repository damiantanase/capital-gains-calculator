import type { SplitEvent } from "./types";

export interface CgtTradeInput {
  /** Optional trade ID. Auto-assigned sequentially if omitted. */
  id?: number;
  /** Trade date in YYYY-MM-DD format. Must be on or after 2008-04-06. */
  date: string;
  /** Trade type: "buy" (acquisition), "sell" (disposal), or "transfer" (no-gain/no-loss gift to spouse). */
  type: "buy" | "sell" | "transfer";
  /** Stock ticker symbol (e.g., "AAPL", "VOD.L"). Case-sensitive. */
  symbol: string;
  /** Number of shares traded. Must be positive. */
  quantity: number;
  /** Price per share in trade currency (converted to GBP via exchangeRate). */
  unitPrice: number;
  /** Fees/commission in trade currency. Adds to cost for buys, reduces proceeds for sells. Default: 0. */
  allowableExpenditure?: number;
  /** Exchange rate: units of trade currency per 1 GBP. Omit or use 1 for GBP-denominated trades. */
  exchangeRate?: number;
}

export class TradeModel {
  readonly id: number;
  readonly date: string;
  readonly type: "buy" | "sell" | "transfer";
  readonly symbol: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly allowableExpenditure: number;
  readonly exchangeRate: number;
  readonly adjustmentFactor: number;

  constructor(data: {
    id: number;
    date: string;
    type: "buy" | "sell" | "transfer";
    symbol: string;
    quantity: number;
    unitPrice: number;
    allowableExpenditure: number;
    exchangeRate: number;
    adjustmentFactor: number;
  }) {
    this.id = data.id;
    this.date = data.date;
    this.type = data.type;
    this.symbol = data.symbol;
    this.quantity = data.quantity;
    this.unitPrice = data.unitPrice;
    this.allowableExpenditure = data.allowableExpenditure;
    this.exchangeRate = data.exchangeRate;
    this.adjustmentFactor = data.adjustmentFactor;
  }

  /** Gross proceeds in GBP (unitPrice × quantity / exchangeRate). */
  proceeds(): number {
    return (this.unitPrice * this.quantity) / this.exchangeRate;
  }

  /**
   * The HMRC-relevant value for this trade in GBP:
   * - Buy/transfer: cost basis (proceeds + fees) — fees increase allowable cost
   * - Sell: net proceeds (proceeds - fees) — fees reduce disposal proceeds
   */
  value(): number {
    if (this.type === "sell") {
      return this.proceeds() - this.fees();
    }
    return this.proceeds() + this.fees();
  }

  /** Fees/commission in GBP. */
  fees(): number {
    return this.allowableExpenditure / this.exchangeRate;
  }

  /** Quantity adjusted for all subsequent stock splits. */
  adjustedQuantity(): number {
    return this.quantity * this.adjustmentFactor;
  }
}

function assignIds(inputs: CgtTradeInput[]): number[] {
  const maxExplicitId = inputs.reduce((max, t) => (t.id != null ? Math.max(max, t.id) : max), 0);
  let nextAutoId = maxExplicitId + 1;
  return inputs.map((t) => t.id ?? nextAutoId++);
}

/**
 * Convert an array of CgtTradeInput into TradeModel instances,
 * applying defaults and computing adjustment factors from split events.
 */
export function prepareTrades(
  inputs: CgtTradeInput[],
  splitEvents: SplitEvent[] = []
): TradeModel[] {
  const ids = assignIds(inputs);

  return inputs.map((input, i) => {
    const id = ids[i];
    let adjustmentFactor = 1;
    for (const split of splitEvents) {
      if (split.symbol === input.symbol && split.date > input.date) {
        adjustmentFactor *= split.ratioTo / split.ratioFrom;
      }
    }
    return new TradeModel({
      id,
      date: input.date,
      type: input.type,
      symbol: input.symbol,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      allowableExpenditure: input.allowableExpenditure ?? 0,
      exchangeRate: input.exchangeRate ?? 1,
      adjustmentFactor,
    });
  });
}
