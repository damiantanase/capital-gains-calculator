import type { CgNormalisedTransaction } from "./types/index.js";
import { TradeModel } from "./trade.js";
import { formatDate } from "./utils.js";

/**
 * Merge same-day/symbol/type trades into single TradeModel entries.
 *
 * Input must already be sorted (as produced by prepareTrades); group order is
 * preserved so the merged array stays chronological. Each merged model is
 * assigned a sequential id used as its public normalisedTradeId.
 */
export function mergeTrades(sorted: TradeModel[]): TradeModel[] {
  const groups = groupTrades(sorted);
  return Array.from(groups.values()).map((group, id) => TradeModel.merge(group, id));
}

/** Convert merged trades into the public CgNormalisedTransaction[] output format (1:1). */
export function toNormalisedTransactions(merged: TradeModel[]): CgNormalisedTransaction[] {
  return merged.map((t) => ({
    normalisedTradeId: t.id,
    date: t.date,
    type: t.type,
    symbol: t.symbol,
    originalQuantity: t.originalQuantity,
    splitFactor: t.splitFactor,
    quantity: t.getQuantity(),
    valueGBP: t.valueGBP,
    feesGBP: t.feesGBP,
    inputIndices: t.inputIndices,
  }));
}

function groupTrades(sorted: TradeModel[]): Map<string, TradeModel[]> {
  const groups = new Map<string, TradeModel[]>();
  for (const t of sorted) {
    const key = `${formatDate(t.date)}|${t.symbol}|${t.type}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }
    group.push(t);
  }
  return groups;
}
