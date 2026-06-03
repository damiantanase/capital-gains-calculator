import type {
  CgSplitEvent,
  CgEvent,
  CgMatch,
  CgNormalisedTransaction,
  CgRatePeriodSummary,
  CgTaxYearSummary,
  CgSection104Pool,
} from "./types/index.js";
import {
  assertDefined,
  countAcquisitions,
  countDisposals,
  daysBetween,
  deriveEventCostGBP,
  deriveEventGainGBP,
  deriveMatchCostGBP,
  deriveMatchGainGBP,
  deriveMatchedDate,
  derivePoolImpact,
  isZeroShares,
  sumCosts,
  sumFees,
  sumGains,
  sumLosses,
  sumNetGain,
  sumProceeds,
  type EventDeriveContext,
} from "./utils.js";
import { getTaxYearForDate } from "./helpers.js";
import { getTaxYearConfig } from "./hmrc-config.js";
import type { TradeModel } from "./trade.js";

/**
 * Record a single match between a disposal and a buy at the moment it is made.
 *
 * Appends to BOTH audit trails — the disposal's match cites the buy as its cost
 * source, the buy's match cites the disposal as its destination — and decrements
 * both remainders. `adjustedQuantity` is in split-adjusted shares; each side's
 * originalMatchedQuantity is de-adjusted by that side's own splitFactor (a buy and
 * its matched disposal can carry different split factors).
 */
function recordMatch(
  disposal: TradeModel,
  buy: TradeModel,
  adjustedQuantity: number,
  rule: "same-day" | "bed-and-breakfast"
): void {
  disposal.matches.push({
    rule,
    originalMatchedQuantity: adjustedQuantity / disposal.splitFactor,
    normalisedTradeId: buy.id,
  });
  buy.matches.push({
    rule,
    originalMatchedQuantity: adjustedQuantity / buy.splitFactor,
    normalisedTradeId: disposal.id,
  });
  disposal.remaining -= adjustedQuantity;
  buy.remaining -= adjustedQuantity;
}

/**
 * Run the HMRC matching engine and produce tax year summaries.
 *
 * Implements, in strict priority order:
 * 1. Same-day rule — match disposals with acquisitions on the same day
 * 2. Bed & breakfast rule — match disposals with acquisitions within the following 30 days
 * 3. Section 104 pool — match remaining disposals against the weighted average cost pool
 *
 * Each match is recorded on both sides as it is made (see recordMatch), so by the
 * time the pool pass runs every trade already carries its same-day and B&B matches;
 * the pool pass only appends the Section 104 residual.
 */
export function matchAndPool(
  trades: TradeModel[],
  splitEvents: CgSplitEvent[],
  transactions: CgNormalisedTransaction[]
): CgTaxYearSummary[] {
  const buys = trades.filter((t) => t.type === "buy");

  // Disposals (sells then transfers) match identically against acquisitions. The
  // sell-before-transfer ordering is part of the matching contract: when a single
  // acquisition could satisfy both a sell and a transfer, the sell claims it first.
  const disposals = [
    ...trades.filter((t) => t.type === "sell"),
    ...trades.filter((t) => t.type === "transfer"),
  ];

  // Same-day must claim acquisitions across ALL disposals before B&B sees them,
  // so the two phases stay separate and run in this order.
  matchSameDay(disposals, buys);
  matchBedAndBreakfast(disposals, buys);

  const { events, poolSnapshots } = processPoolEvents(trades, splitEvents, transactions);
  return buildTaxYearSummaries(events, poolSnapshots);
}

// --- Pass 1a: Same-day matching ---

function matchSameDay(disposals: TradeModel[], buys: TradeModel[]): void {
  for (const disposal of disposals) {
    // After merging there is at most one buy per (date, symbol), so a same-day
    // acquisition is a single merged buy — already the weighted-average composite.
    const sameDayBuy = buys.find(
      (b) =>
        b.symbol === disposal.symbol &&
        b.date.getTime() === disposal.date.getTime() &&
        !isZeroShares(b.remaining)
    );
    if (sameDayBuy === undefined) continue;

    const matched = Math.min(disposal.remaining, sameDayBuy.remaining);
    recordMatch(disposal, sameDayBuy, matched, "same-day");
  }
}

// --- Pass 1b: Bed & breakfast (30-day rule) ---

function matchBedAndBreakfast(disposals: TradeModel[], buys: TradeModel[]): void {
  for (const disposal of disposals) {
    if (isZeroShares(disposal.remaining)) continue;

    // Acquisitions in the day+1..day+30 window, earliest first (FIFO per
    // TCGA92 s.106A(5)(b): match "securities acquired at an earlier time within
    // that period, rather than ... at a later time"). `buys` retains chronological
    // order, so the filtered list is already FIFO-ordered.
    const windowBuys = buys.filter((b) => {
      if (b.symbol !== disposal.symbol || isZeroShares(b.remaining)) return false;
      const days = daysBetween(disposal.date, b.date);
      return days > 0 && days <= 30;
    });

    for (const buy of windowBuys) {
      if (isZeroShares(disposal.remaining)) break;
      const matched = Math.min(buy.remaining, disposal.remaining);
      recordMatch(disposal, buy, matched, "bed-and-breakfast");
    }
  }
}

// --- Pass 2: Pool event processing ---

interface PoolEventResult {
  events: CgEvent[];
  poolSnapshots: Record<string, CgSection104Pool[]>;
}

function processPoolEvents(
  trades: TradeModel[],
  splitEvents: CgSplitEvent[],
  transactions: CgNormalisedTransaction[]
): PoolEventResult {
  const pools = new Map<string, { shares: number; costGBP: number }>();
  const events: CgEvent[] = [];
  const poolSnapshots: Record<string, CgSection104Pool[]> = {};
  let lastTaxYear = "";

  function capturePoolState(asOfDate?: Date): CgSection104Pool[] {
    return Array.from(pools.entries())
      .filter(([, p]) => !isZeroShares(p.shares))
      .map(([symbol, p]) => {
        let futureSplitFactor = 1;
        if (asOfDate) {
          for (const se of splitEvents) {
            if (se.symbol === symbol && se.date.getTime() > asOfDate.getTime()) {
              futureSplitFactor *= se.ratioTo / se.ratioFrom;
            }
          }
        }
        const realShares = p.shares / futureSplitFactor;
        return { symbol, shares: realShares, costGBP: p.costGBP };
      });
  }

  // Process chronologically. Within a date, buys settle before sells before
  // transfers (a stable sort preserves this grouped order).
  const ordered = [
    ...trades.filter((t) => t.type === "buy"),
    ...trades.filter((t) => t.type === "sell"),
    ...trades.filter((t) => t.type === "transfer"),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const trade of ordered) {
    const currentTaxYear = getTaxYearForDate(trade.date);
    if (lastTaxYear && currentTaxYear !== lastTaxYear) {
      poolSnapshots[lastTaxYear] = capturePoolState();
    }
    lastTaxYear = currentTaxYear;

    const poolBefore = capturePoolState(trade.date);

    if (trade.type === "buy") {
      // Shares not claimed by same-day/B&B matching enter the Section 104 pool.
      if (!isZeroShares(trade.remaining)) {
        const pool = pools.get(trade.symbol) ?? { shares: 0, costGBP: 0 };
        const proportion = trade.remaining / trade.getQuantity();
        pool.shares += trade.remaining;
        pool.costGBP += proportion * trade.valueGBP;
        pools.set(trade.symbol, pool);
        trade.matches.push({
          rule: "section-104",
          originalMatchedQuantity: trade.remaining / trade.splitFactor,
        });
      }
    } else {
      // Disposal (sell or transfer): unmatched shares come from the pool at its
      // weighted average cost. A residual here always has pool shares to draw on
      // (position validation guarantees it), so the pool must exist.
      if (!isZeroShares(trade.remaining)) {
        const pool = assertDefined(
          pools.get(trade.symbol),
          `Section 104 pool missing for ${trade.symbol} disposal`
        );
        const sharesToRemove = Math.min(trade.remaining, pool.shares);
        trade.matches.push({
          rule: "section-104",
          originalMatchedQuantity: sharesToRemove / trade.splitFactor,
        });
        const costPerShare = pool.costGBP / pool.shares;
        pool.costGBP -= sharesToRemove * costPerShare;
        pool.shares -= sharesToRemove;
      }
    }

    const poolAfter = capturePoolState(trade.date);

    const quantity = trade.getQuantity();
    const ctx: EventDeriveContext = {
      type: trade.type,
      symbol: trade.symbol,
      splitFactor: trade.splitFactor,
      quantity,
      valueGBP: trade.valueGBP,
      poolBefore,
    };

    // Map the engine's working matches to public CgMatch, baking cost/gain/matchedDate.
    const matches: CgMatch[] = trade.matches.map((m) => {
      const costGBP = deriveMatchCostGBP(m, ctx, transactions);
      const match: CgMatch = {
        rule: m.rule,
        originalMatchedQuantity: m.originalMatchedQuantity,
        costGBP,
        gainGBP: deriveMatchGainGBP(m, ctx, costGBP),
      };
      if (m.normalisedTradeId !== undefined) match.normalisedTradeId = m.normalisedTradeId;
      const matchedDate = deriveMatchedDate(m, transactions);
      if (matchedDate !== undefined) match.matchedDate = matchedDate;
      return match;
    });

    const costGBP = deriveEventCostGBP(matches);

    events.push({
      type: trade.type,
      date: trade.date,
      symbol: trade.symbol,
      originalQuantity: trade.originalQuantity,
      splitFactor: trade.splitFactor,
      quantity,
      valueGBP: trade.valueGBP,
      feesGBP: trade.feesGBP,
      matches,
      costGBP,
      gainGBP: deriveEventGainGBP(ctx, matches, costGBP),
      poolBefore,
      poolAfter,
      poolImpact: derivePoolImpact(poolBefore, poolAfter, trade.symbol),
    });
  }

  if (lastTaxYear) {
    poolSnapshots[lastTaxYear] = capturePoolState();
  }

  return { events, poolSnapshots };
}

// --- Build tax year summaries ---

function buildTaxYearSummaries(
  events: CgEvent[],
  poolSnapshots: Record<string, CgSection104Pool[]>
): CgTaxYearSummary[] {
  const byYear = new Map<string, CgEvent[]>();
  for (const e of events) {
    const ty = getTaxYearForDate(e.date);
    let yearEvents = byYear.get(ty);
    if (yearEvents === undefined) {
      yearEvents = [];
      byYear.set(ty, yearEvents);
    }
    yearEvents.push(e);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([taxYear, yearEvents]) => {
      // Input validation rejects any trade dated past the latest supported tax
      // year, so every tax year reaching here has config. assertDefined keeps the
      // invariant loud if that ever regresses.
      const yearConfig = assertDefined(getTaxYearConfig(taxYear), `tax year config for ${taxYear}`);
      const aea = yearConfig.limits.annualExemptAmount;
      const ratePeriods = yearConfig.ratePeriods;

      // Build each period with its baked aggregates (derived from the events' own
      // baked gainGBP/costGBP). Tax fields depend on allocatedAEA and are filled in
      // after the AEA allocation pass below.
      const periods: CgRatePeriodSummary[] = ratePeriods.map((period) => {
        const periodEvents = yearEvents.filter(
          (e) =>
            e.date.getTime() >= period.from.getTime() && e.date.getTime() <= period.to.getTime()
        );

        return {
          period,
          allocatedAEA: 0,
          events: periodEvents,
          proceedsGBP: sumProceeds(periodEvents),
          costsGBP: sumCosts(periodEvents),
          feesGBP: sumFees(periodEvents),
          gainsGBP: sumGains(periodEvents),
          lossesGBP: sumLosses(periodEvents),
          netGainGBP: sumNetGain(periodEvents),
          taxableGainGBP: 0,
          taxBasicGBP: 0,
          taxHigherGBP: 0,
          disposalCount: countDisposals(periodEvents),
          acquisitionCount: countAcquisitions(periodEvents),
        };
      });

      const yearNetGain = periods.reduce((sum, p) => sum + p.netGainGBP, 0);
      const yearTaxableGain = Math.max(0, yearNetGain - aea);
      const totalPositiveGains = periods.reduce((sum, p) => sum + Math.max(0, p.netGainGBP), 0);

      // HMRC sets the annual exempt amount (and losses from other periods) against
      // the gains charged at the HIGHEST rate first — the allocation most beneficial
      // to the taxpayer (Capital Gains Manual CG21520). `allocatedAEA` is the portion
      // of a period's net gain that ends up untaxed; the per-period taxable gain is
      // netGain - allocatedAEA. Only the split across periods changes here — the
      // year-level taxable total (yearTaxableGain) is unaffected by the order.
      //
      // The total amount of positive gain that escapes tax (AEA plus any cross-period
      // loss relief) is totalPositiveGains - yearTaxableGain. Apply it to the
      // gaining periods highest-rate-first.
      const totalDeduction = totalPositiveGains - yearTaxableGain;

      // Order gaining periods by headline (higher) rate, descending. Array.sort is
      // stable, so periods on an equal rate keep their chronological order.
      const gainingPeriodsHighestRateFirst = periods
        .map((_, i) => i)
        .filter((i) => periods[i].netGainGBP > 0)
        .sort((a, b) => periods[b].period.higherRate - periods[a].period.higherRate);

      let remainingDeduction = totalDeduction;
      for (const i of gainingPeriodsHighestRateFirst) {
        const applied = Math.min(remainingDeduction, periods[i].netGainGBP);
        periods[i].allocatedAEA = applied;
        remainingDeduction -= applied;
      }

      // Now allocatedAEA is known, finalise each period's taxable gain and tax.
      for (const p of periods) {
        p.taxableGainGBP = Math.max(0, p.netGainGBP - p.allocatedAEA);
        p.taxBasicGBP = p.taxableGainGBP * (p.period.basicRate / 100);
        p.taxHigherGBP = p.taxableGainGBP * (p.period.higherRate / 100);
      }

      const proceedsGBP = periods.reduce((sum, p) => sum + p.proceedsGBP, 0);
      const reportingReasons: CgTaxYearSummary["reportingReasons"] = [];
      if (yearTaxableGain > 0) reportingReasons.push("taxable-gain");
      if (proceedsGBP > yearConfig.limits.reportingThreshold)
        reportingReasons.push("proceeds-exceed-threshold");

      return {
        taxYear,
        limits: yearConfig.limits,
        periods,
        poolAtYearEnd: poolSnapshots[taxYear],
        proceedsGBP,
        costsGBP: periods.reduce((sum, p) => sum + p.costsGBP, 0),
        feesGBP: periods.reduce((sum, p) => sum + p.feesGBP, 0),
        gainsGBP: periods.reduce((sum, p) => sum + p.gainsGBP, 0),
        lossesGBP: periods.reduce((sum, p) => sum + p.lossesGBP, 0),
        netGainGBP: yearNetGain,
        taxableGainGBP: yearTaxableGain,
        taxBasicGBP: periods.reduce((sum, p) => sum + p.taxBasicGBP, 0),
        taxHigherGBP: periods.reduce((sum, p) => sum + p.taxHigherGBP, 0),
        disposalCount: periods.reduce((sum, p) => sum + p.disposalCount, 0),
        acquisitionCount: periods.reduce((sum, p) => sum + p.acquisitionCount, 0),
        reportingRequired: reportingReasons.length > 0,
        reportingReasons,
        remainingAEAGBP: Math.max(0, aea - Math.max(0, yearNetGain)),
      };
    });
}
