import type { CgSplitEvent, CgTradeInput } from "./types/index.js";

export type { CgTradeInput } from "./types/index.js";

/**
 * Working match state accumulated during the engine pass — the CgMatch fields
 * known before cost/gain are derived. The match engine records these on each
 * TradeModel; match.ts maps them to the public CgMatch (adding costGBP, gainGBP,
 * matchedDate) when it builds each CgEvent.
 */
export interface EngineMatch {
  rule: "same-day" | "bed-and-breakfast" | "section-104";
  originalMatchedQuantity: number;
  normalisedTradeId?: number;
}

export class TradeModel {
  /** Stable identifier, surfaced as CgNormalisedTransaction.normalisedTradeId. */
  readonly id: number;
  readonly date: Date;
  readonly type: "buy" | "sell" | "transfer";
  readonly symbol: string;
  readonly originalQuantity: number;
  readonly splitFactor: number;
  readonly valueGBP: number;
  readonly feesGBP: number;
  /** Original input array positions this model was derived from (one-to-one before merge, one-to-many after). */
  readonly inputIndices: number[];

  /**
   * Matching working state: split-adjusted shares not yet matched. Mutated by the
   * match engine only; each model is created fresh per calculation, so this never
   * leaks between calls and never reaches public output.
   */
  remaining: number;
  /**
   * Matching working state: audit trail accumulated during matching — cost sources
   * for disposals, destinations for buys. Mutated by the match engine only; never
   * reaches public output directly (match.ts maps these to CgMatch, adding the
   * derived cost/gain/matchedDate fields).
   */
  matches: EngineMatch[] = [];

  constructor(data: {
    id: number;
    date: Date;
    type: "buy" | "sell" | "transfer";
    symbol: string;
    originalQuantity: number;
    splitFactor: number;
    valueGBP: number;
    feesGBP: number;
    inputIndices: number[];
  }) {
    this.id = data.id;
    this.date = data.date;
    this.type = data.type;
    this.symbol = data.symbol;
    this.originalQuantity = data.originalQuantity;
    this.splitFactor = data.splitFactor;
    this.valueGBP = data.valueGBP;
    this.feesGBP = data.feesGBP;
    this.inputIndices = data.inputIndices;
    this.remaining = data.originalQuantity * data.splitFactor;
  }

  getQuantity(): number {
    return this.originalQuantity * this.splitFactor;
  }

  static fromInput(input: CgTradeInput, index: number, splitEvents: CgSplitEvent[]): TradeModel {
    let splitFactor = 1;
    for (const split of splitEvents) {
      if (split.symbol === input.symbol && split.date.getTime() > input.date.getTime()) {
        splitFactor *= split.ratioTo / split.ratioFrom;
      }
    }

    const exchangeRate = input.exchangeRate ?? 1;
    const allowableExpenditure = input.allowableExpenditure ?? 0;
    const feesGBP = allowableExpenditure / exchangeRate;
    const proceeds = (input.unitPrice * input.quantity) / exchangeRate;
    const valueGBP =
      input.type === "transfer"
        ? 0
        : input.type === "sell"
          ? proceeds - feesGBP
          : proceeds + feesGBP;

    return new TradeModel({
      date: input.date,
      type: input.type,
      symbol: input.symbol,
      originalQuantity: input.quantity,
      splitFactor,
      valueGBP,
      feesGBP,
      id: index,
      inputIndices: [index],
    });
  }

  /** Combine a group of same-day/symbol/type trades into a single merged model with the given id. */
  static merge(group: TradeModel[], id: number): TradeModel {
    const first = group[0];
    return new TradeModel({
      date: first.date,
      type: first.type,
      symbol: first.symbol,
      originalQuantity: group.reduce((sum, t) => sum + t.originalQuantity, 0),
      splitFactor: first.splitFactor,
      valueGBP: group.reduce((sum, t) => sum + t.valueGBP, 0),
      feesGBP: group.reduce((sum, t) => sum + t.feesGBP, 0),
      id,
      inputIndices: group.flatMap((t) => t.inputIndices),
    });
  }
}

/**
 * Sort comparator for trades: by date, then buys before disposals on the same
 * day (so position validation accepts buy+sell on the same date), then by
 * original input order.
 */
export function compareTrades(a: TradeModel, b: TradeModel): number {
  const dateDiff = a.date.getTime() - b.date.getTime();
  if (dateDiff !== 0) return dateDiff;
  if (a.type !== b.type) {
    if (a.type === "buy") return -1;
    if (b.type === "buy") return 1;
  }
  return a.inputIndices[0] - b.inputIndices[0];
}

export function prepareTrades(
  inputs: CgTradeInput[],
  splitEvents: CgSplitEvent[] = []
): TradeModel[] {
  const trades = inputs.map((input, index) => TradeModel.fromInput(input, index, splitEvents));
  trades.sort(compareTrades);
  return trades;
}
