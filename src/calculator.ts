import type { TradeModel } from "./trade";
import type {
  CgtResult,
  CgtAcquisition,
  CgtDisposal,
  CgtMatch,
  CgtRatePeriodSummary,
  CgtTaxYearSummary,
  PoolImpact,
  Result,
  Section104Pool,
  SplitEvent,
} from "./types";
import type { CgtTradeInput } from "./trade";
import type { ValidationError } from "./normalise";
import { prepareTrades } from "./trade";
import { getTaxYearForDate, SHARE_TOLERANCE } from "./constants";
import { getDefaultAllowances, getTaxYearConfig } from "./hmrc-config";
import { validateInputs, buildNormalisedTransactions } from "./normalise";

function getOrThrow<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  /* istanbul ignore next -- defensive guard: maps are always pre-populated by the caller */
  if (value === undefined) throw new Error(`Internal error: missing map key ${String(key)}`);
  return value;
}

function daysBetween(dateA: string, dateB: string): number {
  const [yA, mA, dA] = dateA.split("-").map(Number);
  const [yB, mB, dB] = dateB.split("-").map(Number);
  const a = Date.UTC(yA, mA - 1, dA);
  const b = Date.UTC(yB, mB - 1, dB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

interface MergedSell {
  id: number;
  date: string;
  symbol: string;
  adjustedQuantity: number;
  originalQuantity: number;
  adjustmentFactor: number;
  considerationGBP: number;
  feesGBP: number;
  netProceedsGBP: number;
  sourceTradeIds: number[];
}

interface MergedBuy {
  id: number;
  date: string;
  symbol: string;
  adjustedQuantity: number;
  originalQuantity: number;
  adjustmentFactor: number;
  allowableCostGBP: number;
  sourceTradeIds: number[];
}

function mergeSells(sells: TradeModel[]): MergedSell[] {
  const groups = new Map<string, TradeModel[]>();
  for (const s of sells) {
    const key = `${s.date}|${s.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key guaranteed by has() check above
    groups.get(key)!.push(s);
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    return {
      id: first.id,
      date: first.date,
      symbol: first.symbol,
      adjustedQuantity: group.reduce((s, t) => s + t.adjustedQuantity(), 0),
      originalQuantity: group.reduce((s, t) => s + t.quantity, 0),
      adjustmentFactor: first.adjustmentFactor,
      considerationGBP: group.reduce((s, t) => s + t.proceeds(), 0),
      feesGBP: group.reduce((s, t) => s + t.fees(), 0),
      netProceedsGBP: group.reduce((s, t) => s + t.value(), 0),
      sourceTradeIds: group.map((t) => t.id),
    };
  });
}

function mergeBuys(buys: TradeModel[]): MergedBuy[] {
  const groups = new Map<string, TradeModel[]>();
  for (const b of buys) {
    const key = `${b.date}|${b.symbol}`;
    if (!groups.has(key)) groups.set(key, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key guaranteed by has() check above
    groups.get(key)!.push(b);
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    return {
      id: first.id,
      date: first.date,
      symbol: first.symbol,
      adjustedQuantity: group.reduce((s, t) => s + t.adjustedQuantity(), 0),
      originalQuantity: group.reduce((s, t) => s + t.quantity, 0),
      adjustmentFactor: first.adjustmentFactor,
      allowableCostGBP: group.reduce((s, t) => s + t.value(), 0),
      sourceTradeIds: group.map((t) => t.id),
    };
  });
}

export interface CalculateCgtOptions {
  /** Tax year to AEA override. Defaults to bundled HMRC values. */
  allowances?: Record<string, number>;
  /** Stock split events for quantity adjustment. */
  splitEvents?: SplitEvent[];
  /** Skip input validation. Default: false. Set to true only if inputs are pre-validated. */
  skipValidation?: boolean;
}

/**
 * Calculate UK Capital Gains Tax for a set of trades.
 *
 * Implements HMRC share matching rules:
 * 1. Same-day rule — match disposals with acquisitions on the same day
 * 2. Bed & breakfast rule — match disposals with acquisitions within the following 30 days
 * 3. Section 104 pool — match remaining disposals against the weighted average cost pool
 *
 * Returns a Result: check `result.ok` before accessing `result.data`.
 */
export function calculateCgt(
  inputs: CgtTradeInput[],
  options?: CalculateCgtOptions
): Result<CgtResult, ValidationError> {
  if (!options?.skipValidation) {
    const errors = validateInputs(inputs);
    if (errors.length > 0) {
      return { ok: false, errors };
    }
  }

  const splitEvents = options?.splitEvents ?? [];
  const defaultAllowances = getDefaultAllowances();
  const allowances = new Map(Object.entries(options?.allowances ?? defaultAllowances));
  const trades = prepareTrades(inputs, splitEvents);

  const sorted = [...trades].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.id - b.id;
  });

  const rawBuys = sorted.filter((t) => t.type === "buy");
  const rawSells = sorted.filter((t) => t.type === "sell");
  const transfers = sorted.filter((t) => t.type === "transfer");

  const mergedSells = mergeSells(rawSells);
  const mergedBuys = mergeBuys(rawBuys);

  const availableBuys = new Map<number, number>();
  const buysBySymbol = new Map<string, MergedBuy[]>();
  for (const mb of mergedBuys) {
    availableBuys.set(mb.id, mb.adjustedQuantity);
    if (!buysBySymbol.has(mb.symbol)) buysBySymbol.set(mb.symbol, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key guaranteed by has() check above
    buysBySymbol.get(mb.symbol)!.push(mb);
  }

  const sellRemainders = new Map<number, number>();
  const sellMatches = new Map<number, CgtMatch[]>();
  for (const ms of mergedSells) {
    sellRemainders.set(ms.id, ms.adjustedQuantity);
    sellMatches.set(ms.id, []);
  }

  matchSameDay(mergedSells, buysBySymbol, availableBuys, sellRemainders, sellMatches);
  matchBedAndBreakfast(mergedSells, buysBySymbol, availableBuys, sellRemainders, sellMatches);

  const { disposals, poolSnapshots, pools, buyPoolSnapshotsBefore, buyPoolSnapshotsAfter, buyPoolImpacts } =
    processPoolEvents(mergedBuys, mergedSells, transfers, availableBuys, sellRemainders, sellMatches, splitEvents);

  const acquisitions = buildAcquisitions(
    mergedBuys, mergedSells, availableBuys, sellMatches, buyPoolImpacts, buyPoolSnapshotsBefore, buyPoolSnapshotsAfter
  );

  const taxYears = buildTaxYearSummaries(disposals, acquisitions, allowances);
  const normalisedTrades = buildNormalisedTransactions(sorted);

  return { ok: true, data: { taxYears, pools, poolSnapshots, splitEvents, normalisedTrades } };
}

// --- Pass 1a: Same-day matching ---

function matchSameDay(
  mergedSells: MergedSell[],
  buysBySymbol: Map<string, MergedBuy[]>,
  availableBuys: Map<number, number>,
  sellRemainders: Map<number, number>,
  sellMatches: Map<number, CgtMatch[]>
): void {
  for (const ms of mergedSells) {
    const symbolBuys = buysBySymbol.get(ms.symbol);
    if (!symbolBuys) continue;
    const sameDayBuys = symbolBuys.filter(
      (mb) => mb.date === ms.date && getOrThrow(availableBuys, mb.id) > 0
    );
    if (sameDayBuys.length === 0) continue;

    let compositeBuyShares = 0;
    let compositeBuyCostGBP = 0;
    for (const mb of sameDayBuys) {
      const available = getOrThrow(availableBuys, mb.id);
      const costPerShare = mb.allowableCostGBP / mb.adjustedQuantity;
      compositeBuyShares += available;
      compositeBuyCostGBP += available * costPerShare;
    }

    const matchedShares = Math.min(ms.adjustedQuantity, compositeBuyShares);
    /* istanbul ignore next -- guard for floating-point edge case; sameDayBuys filter guarantees > 0 */
    if (matchedShares <= SHARE_TOLERANCE) continue;

    const compositeBuyCostPerShare = compositeBuyCostGBP / compositeBuyShares;
    const matchCost = matchedShares * compositeBuyCostPerShare;

    const matches = getOrThrow(sellMatches, ms.id);
    matches.push({
      rule: "same-day",
      quantity: matchedShares,
      originalQuantity: matchedShares / ms.adjustmentFactor,
      costPerShareGBP: compositeBuyCostPerShare,
      costGBP: matchCost,
      gainGBP: 0,
      matchedTradeIds: sameDayBuys.map((mb) => mb.id),
      matchedDate: ms.date,
      originalCompositeBuyShares: compositeBuyShares / ms.adjustmentFactor,
    });

    const currentRemainder = getOrThrow(sellRemainders, ms.id) - matchedShares;
    sellRemainders.set(ms.id, currentRemainder);

    let buySharesRemaining = matchedShares;
    for (const mb of sameDayBuys) {
      /* istanbul ignore next -- mergeBuys groups same-day same-symbol, so sameDayBuys has at most 1 entry */
      if (buySharesRemaining <= SHARE_TOLERANCE) break;
      const available = getOrThrow(availableBuys, mb.id);
      const consumed = Math.min(available, buySharesRemaining);
      availableBuys.set(mb.id, available - consumed);
      buySharesRemaining -= consumed;
    }
  }
}

// --- Pass 1b: Bed & breakfast (30-day rule) ---

function matchBedAndBreakfast(
  mergedSells: MergedSell[],
  buysBySymbol: Map<string, MergedBuy[]>,
  availableBuys: Map<number, number>,
  sellRemainders: Map<number, number>,
  sellMatches: Map<number, CgtMatch[]>
): void {
  for (const ms of mergedSells) {
    let remaining = getOrThrow(sellRemainders, ms.id);
    if (remaining <= SHARE_TOLERANCE) continue;

    const matches = getOrThrow(sellMatches, ms.id);

    const symbolBuys = buysBySymbol.get(ms.symbol);
    if (!symbolBuys) continue;
    // symbolBuys is already date-sorted (from sorted input), so filter preserves FIFO order
    const bAndBBuys = symbolBuys.filter((mb) => {
      const days = daysBetween(ms.date, mb.date);
      return days > 0 && days <= 30 && getOrThrow(availableBuys, mb.id) > 0;
    });

    for (const bbb of bAndBBuys) {
      if (remaining <= SHARE_TOLERANCE) break;
      const available = getOrThrow(availableBuys, bbb.id);
      const matched = Math.min(available, remaining);
      const costPerShare = bbb.allowableCostGBP / bbb.adjustedQuantity;
      const matchCost = matched * costPerShare;

      matches.push({
        rule: "bed-and-breakfast",
        quantity: matched,
        originalQuantity: matched / ms.adjustmentFactor,
        costPerShareGBP: costPerShare,
        costGBP: matchCost,
        gainGBP: 0,
        matchedTradeIds: [bbb.id],
        matchedDate: bbb.date,
      });

      availableBuys.set(bbb.id, available - matched);
      remaining -= matched;
    }

    sellRemainders.set(ms.id, remaining);
  }
}

// --- Pass 2: Pool event processing ---

interface PoolEventResult {
  disposals: CgtDisposal[];
  poolSnapshots: Record<string, Section104Pool[]>;
  pools: Section104Pool[];
  buyPoolSnapshotsBefore: Map<number, Section104Pool[]>;
  buyPoolSnapshotsAfter: Map<number, Section104Pool[]>;
  buyPoolImpacts: Map<number, PoolImpact | null>;
}

function processPoolEvents(
  mergedBuys: MergedBuy[],
  mergedSells: MergedSell[],
  transfers: TradeModel[],
  availableBuys: Map<number, number>,
  sellRemainders: Map<number, number>,
  sellMatches: Map<number, CgtMatch[]>,
  splitEvents: SplitEvent[]
): PoolEventResult {
  const pools = new Map<string, { shares: number; costGBP: number }>();
  const disposals: CgtDisposal[] = [];
  const poolSnapshots: Record<string, Section104Pool[]> = {};
  let lastTaxYear = "";

  const buyPoolSnapshotsBefore = new Map<number, Section104Pool[]>();
  const buyPoolSnapshotsAfter = new Map<number, Section104Pool[]>();
  const buyPoolImpacts = new Map<number, PoolImpact | null>();

  function capturePoolState(asOfDate?: string): Section104Pool[] {
    return Array.from(pools.entries())
      .filter(([, p]) => p.shares > SHARE_TOLERANCE)
      .map(([symbol, p]) => {
        let futureSplitFactor = 1;
        if (asOfDate) {
          for (const se of splitEvents) {
            if (se.symbol === symbol && se.date > asOfDate) {
              futureSplitFactor *= se.ratioTo / se.ratioFrom;
            }
          }
        }
        const realShares = p.shares / futureSplitFactor;
        return { symbol, shares: realShares, originalShares: realShares, costGBP: p.costGBP };
      });
  }

  type PoolEvent =
    | { kind: "buy"; data: MergedBuy }
    | { kind: "sell"; data: MergedSell }
    | { kind: "transfer"; data: TradeModel };

  const allEvents: PoolEvent[] = [];
  for (const mb of mergedBuys) allEvents.push({ kind: "buy", data: mb });
  for (const ms of mergedSells) allEvents.push({ kind: "sell", data: ms });
  for (const t of transfers) allEvents.push({ kind: "transfer", data: t });
  allEvents.sort((a, b) => {
    if (a.data.date < b.data.date) return -1;
    if (a.data.date > b.data.date) return 1;
    return a.data.id - b.data.id;
  });

  for (const evt of allEvents) {
    const evtDate = evt.data.date;
    const currentTaxYear = getTaxYearForDate(evtDate);

    if (lastTaxYear && currentTaxYear !== lastTaxYear) {
      poolSnapshots[lastTaxYear] = capturePoolState();
    }
    lastTaxYear = currentTaxYear;

    if (evt.kind === "buy") {
      const mb = evt.data;
      buyPoolSnapshotsBefore.set(mb.id, capturePoolState(mb.date));
      const remaining = getOrThrow(availableBuys, mb.id);
      let buyPoolImpact: PoolImpact | null = null;
      if (remaining > SHARE_TOLERANCE) {
        const pool = pools.get(mb.symbol) ?? { shares: 0, costGBP: 0 };
        const proportion = remaining / mb.adjustedQuantity;
        const costAdded = proportion * mb.allowableCostGBP;
        pool.shares += remaining;
        pool.costGBP += costAdded;
        pools.set(mb.symbol, pool);
        buyPoolImpact = { symbol: mb.symbol, sharesAdded: remaining, costAdded };
      }
      buyPoolSnapshotsAfter.set(mb.id, capturePoolState(mb.date));
      buyPoolImpacts.set(mb.id, buyPoolImpact);
    } else if (evt.kind === "sell") {
      const ms = evt.data;
      const poolStateBefore = capturePoolState(ms.date);
      const remaining = getOrThrow(sellRemainders, ms.id);
      const matches = getOrThrow(sellMatches, ms.id);
      const proceedsPerShare = ms.netProceedsGBP / ms.adjustedQuantity;

      let sellPoolImpact: PoolImpact | null = null;
      if (remaining > SHARE_TOLERANCE) {
        const pool = pools.get(ms.symbol);
        if (pool && pool.shares > SHARE_TOLERANCE) {
          const sharesToRemove = Math.min(remaining, pool.shares);
          const costPerShare = pool.costGBP / pool.shares;
          const matchCost = sharesToRemove * costPerShare;

          matches.push({
            rule: "section-104",
            quantity: sharesToRemove,
            originalQuantity: sharesToRemove / ms.adjustmentFactor,
            costPerShareGBP: costPerShare,
            costGBP: matchCost,
            gainGBP: 0,
            poolSharesAtMatch: pool.shares,
            originalPoolSharesAtMatch: pool.shares / ms.adjustmentFactor,
          });

          pool.costGBP -= matchCost;
          pool.shares -= sharesToRemove;
          sellPoolImpact = { symbol: ms.symbol, sharesRemoved: sharesToRemove, costRemoved: matchCost };
        }
      }

      for (const m of matches) {
        m.gainGBP = m.quantity * proceedsPerShare - m.costGBP;
      }

      const totalCost = matches.reduce((sum, m) => sum + m.costGBP, 0);
      const totalProceeds = matches.reduce((sum, m) => sum + m.quantity, 0) * proceedsPerShare;

      disposals.push({
        type: "disposal",
        tradeId: ms.id,
        date: ms.date,
        symbol: ms.symbol,
        quantity: ms.adjustedQuantity,
        originalQuantity: ms.originalQuantity,
        pricePerShareGBP: ms.considerationGBP / ms.adjustedQuantity,
        originalPricePerShareGBP: ms.considerationGBP / ms.originalQuantity,
        adjustmentFactor: ms.adjustmentFactor,
        feesGBP: ms.feesGBP,
        proceedsGBP: totalProceeds,
        totalCostGBP: totalCost,
        gainGBP: totalProceeds - totalCost,
        matches,
        poolImpact: sellPoolImpact,
        poolStateBefore,
        poolStateAfter: capturePoolState(ms.date),
      });
    } else { // transfer — removes shares from pool at average cost, zero gain
      const trade = evt.data;
      const adjQty = trade.adjustedQuantity();
      const pool = pools.get(trade.symbol);

      if (pool && pool.shares > SHARE_TOLERANCE) {
        const transferPoolStateBefore = capturePoolState(trade.date);
        const sharesToRemove = Math.min(adjQty, pool.shares);
        const costPerShare = pool.costGBP / pool.shares;
        const matchCost = sharesToRemove * costPerShare;

        pool.costGBP -= matchCost;
        pool.shares -= sharesToRemove;

        disposals.push({
          type: "transfer",
          tradeId: trade.id,
          date: trade.date,
          symbol: trade.symbol,
          quantity: adjQty,
          originalQuantity: trade.quantity,
          pricePerShareGBP: costPerShare,
          originalPricePerShareGBP: trade.unitPrice / trade.exchangeRate,
          adjustmentFactor: trade.adjustmentFactor,
          feesGBP: 0,
          proceedsGBP: matchCost,
          totalCostGBP: matchCost,
          gainGBP: 0,
          matches: [
            {
              rule: "section-104",
              quantity: sharesToRemove,
              originalQuantity: sharesToRemove / trade.adjustmentFactor,
              costPerShareGBP: costPerShare,
              costGBP: matchCost,
              gainGBP: 0,
              poolSharesAtMatch: pool.shares + sharesToRemove,
              originalPoolSharesAtMatch: (pool.shares + sharesToRemove) / trade.adjustmentFactor,
            },
          ],
          poolImpact: { symbol: trade.symbol, sharesRemoved: sharesToRemove, costRemoved: matchCost },
          poolStateBefore: transferPoolStateBefore,
          poolStateAfter: capturePoolState(trade.date),
        });
      }
    }
  }

  if (lastTaxYear) {
    poolSnapshots[lastTaxYear] = capturePoolState();
  }

  return { disposals, poolSnapshots, pools: capturePoolState(), buyPoolSnapshotsBefore, buyPoolSnapshotsAfter, buyPoolImpacts };
}

// --- Build acquisitions ---

function buildAcquisitions(
  mergedBuys: MergedBuy[],
  mergedSells: MergedSell[],
  availableBuys: Map<number, number>,
  sellMatches: Map<number, CgtMatch[]>,
  buyPoolImpacts: Map<number, PoolImpact | null>,
  buyPoolSnapshotsBefore: Map<number, Section104Pool[]>,
  buyPoolSnapshotsAfter: Map<number, Section104Pool[]>
): CgtAcquisition[] {
  const acquisitions: CgtAcquisition[] = [];

  for (const mb of mergedBuys) {
    const adjQty = mb.adjustedQuantity;
    const remaining = getOrThrow(availableBuys, mb.id);
    const consumed = adjQty - remaining;
    const adjustmentFactor = mb.adjustmentFactor;
    const dispositions: CgtAcquisition["dispositions"] = [];

    if (consumed > SHARE_TOLERANCE) {
      for (const ms of mergedSells) {
        const matches = getOrThrow(sellMatches, ms.id);
        for (const m of matches) {
          if (m.matchedTradeIds?.includes(mb.id)) {
            const matchedAdj = Math.min(consumed, m.quantity);
            dispositions.push({
              rule: m.rule === "same-day" ? "same-day" : "bed-and-breakfast",
              quantity: matchedAdj,
              originalQuantity: matchedAdj / adjustmentFactor,
              matchedDate: ms.date,
            });
          }
        }
      }
    }
    if (remaining > SHARE_TOLERANCE) {
      dispositions.push({
        rule: "pool",
        quantity: remaining,
        originalQuantity: remaining / adjustmentFactor,
      });
    }

    acquisitions.push({
      tradeId: mb.id,
      date: mb.date,
      symbol: mb.symbol,
      quantity: adjQty,
      originalQuantity: mb.originalQuantity,
      costGBP: mb.allowableCostGBP,
      dispositions,
      poolImpact: getOrThrow(buyPoolImpacts, mb.id),
      poolStateBefore: getOrThrow(buyPoolSnapshotsBefore, mb.id),
      poolStateAfter: getOrThrow(buyPoolSnapshotsAfter, mb.id),
    });
  }

  return acquisitions;
}

// --- Build tax year summaries ---

function buildTaxYearSummaries(
  disposals: CgtDisposal[],
  acquisitions: CgtAcquisition[],
  allowances: Map<string, number>
): CgtTaxYearSummary[] {
  const byYear = new Map<string, CgtDisposal[]>();
  for (const d of disposals) {
    const ty = getTaxYearForDate(d.date);
    if (!byYear.has(ty)) byYear.set(ty, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- key guaranteed by has() check above
    byYear.get(ty)!.push(d);
  }
  for (const a of acquisitions) {
    const ty = getTaxYearForDate(a.date);
    if (!byYear.has(ty)) byYear.set(ty, []);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([taxYear, yearDisposals]) => {
      const actualDisposals = yearDisposals.filter((d) => d.type === "disposal");
      const aea = allowances.get(taxYear);
      if (aea === undefined) {
        throw new Error(`No annual exempt amount configured for tax year ${taxYear}`);
      }

      const yearConfig = getTaxYearConfig(taxYear);
      if (!yearConfig) {
        throw new Error(`No tax year configuration found for ${taxYear}`);
      }
      const ratePeriods = yearConfig.ratePeriods;

      const periods: CgtRatePeriodSummary[] = ratePeriods.map((period) => {
        const periodDisposals = actualDisposals.filter(
          (d) => d.date >= period.from && d.date <= period.to
        );
        const periodProceeds = periodDisposals.reduce((sum, d) => sum + d.proceedsGBP, 0);
        const periodCosts = periodDisposals.reduce((sum, d) => sum + d.totalCostGBP, 0);
        const periodGains = periodDisposals
          .filter((d) => d.gainGBP > 0)
          .reduce((sum, d) => sum + d.gainGBP, 0);
        const periodLosses = periodDisposals
          .filter((d) => d.gainGBP < 0)
          .reduce((sum, d) => sum + d.gainGBP, 0);

        return {
          from: period.from,
          to: period.to,
          rates: period.rates,
          totalProceeds: periodProceeds,
          totalCosts: periodCosts,
          totalGains: periodGains,
          totalLosses: periodLosses,
          netGainLoss: periodGains + periodLosses,
          taxableGain: 0,
          taxBasicRate: 0,
          taxHigherRate: 0,
          disposalCount: periodDisposals.length,
          disposals: periodDisposals,
        };
      });

      // Distribute AEA across periods in chronological order, then compute tax
      let remainingAEA = aea;
      for (const period of periods) {
        const periodGain = Math.max(0, period.netGainLoss);
        const aeaForPeriod = Math.min(remainingAEA, periodGain);
        remainingAEA -= aeaForPeriod;
        period.taxableGain = periodGain - aeaForPeriod;
        period.taxBasicRate = period.taxableGain * (period.rates.basic / 100);
        period.taxHigherRate = period.taxableGain * (period.rates.higher / 100);
      }

      const totalProceeds = actualDisposals.reduce((sum, d) => sum + d.proceedsGBP, 0);
      const totalCosts = actualDisposals.reduce((sum, d) => sum + d.totalCostGBP, 0);
      const totalGains = actualDisposals.filter((d) => d.gainGBP > 0).reduce((sum, d) => sum + d.gainGBP, 0);
      const totalLosses = actualDisposals.filter((d) => d.gainGBP < 0).reduce((sum, d) => sum + d.gainGBP, 0);

      const yearAcquisitions = acquisitions.filter((a) => getTaxYearForDate(a.date) === taxYear);

      return {
        taxYear,
        annualExemptAmount: aea,
        totalProceeds,
        totalCosts,
        totalGains,
        totalLosses,
        netGainLoss: totalGains + totalLosses,
        taxableGain: periods.reduce((sum, p) => sum + p.taxableGain, 0),
        taxBasicRate: periods.reduce((sum, p) => sum + p.taxBasicRate, 0),
        taxHigherRate: periods.reduce((sum, p) => sum + p.taxHigherRate, 0),
        disposalCount: actualDisposals.length,
        disposals: yearDisposals,
        acquisitions: yearAcquisitions,
        periods,
      };
    });
}

