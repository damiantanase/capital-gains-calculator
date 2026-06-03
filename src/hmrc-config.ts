import type { CgTaxYearConfig, CgSupportInfo } from "./types/index.js";

// =============================================================================
// Internal config representation
//
// The canonical HMRC table is the single source of truth for rates/allowances.
// It stores rate-period boundaries as ISO "YYYY-MM-DD" strings (immutable
// primitives) and uses readonly types so neither internal code nor consumers can
// mutate it. Public Date objects are minted fresh only at the boundary, by
// toPublicConfig — so every CgTaxYearConfig handed out (from getTaxYearConfig or
// getSupportInfo, and onward onto calculation results) is an independent copy and
// can never alias this table. ISO strings keep the dates directly auditable
// against HMRC publications and parse to UTC midnight via new Date("YYYY-MM-DD").
// =============================================================================

interface InternalRatePeriod {
  /** Start date of this rate period (inclusive), as ISO "YYYY-MM-DD" (UTC). */
  readonly from: string;
  /** End date of this rate period (inclusive), as ISO "YYYY-MM-DD" (UTC). */
  readonly to: string;
  readonly basicRate: number;
  readonly higherRate: number;
}

interface InternalTaxYearConfig {
  readonly taxYear: string;
  readonly limits: { readonly annualExemptAmount: number; readonly reportingThreshold: number };
  readonly ratePeriods: readonly InternalRatePeriod[];
}

const taxYearConfig: readonly InternalTaxYearConfig[] = [
  // 2008/09–2009/10: Flat 18% rate for all gains
  {
    taxYear: "2008/09",
    limits: { annualExemptAmount: 9600, reportingThreshold: 38400 },
    ratePeriods: [{ from: "2008-04-06", to: "2009-04-05", basicRate: 18, higherRate: 18 }],
  },
  {
    taxYear: "2009/10",
    limits: { annualExemptAmount: 10100, reportingThreshold: 40400 },
    ratePeriods: [{ from: "2009-04-06", to: "2010-04-05", basicRate: 18, higherRate: 18 }],
  },
  // 2010/11: Rates changed mid-year on 23 June 2010 — flat 18% until 22 June,
  // then two-tier 18%/28% from 23 June (income-linked).
  {
    taxYear: "2010/11",
    limits: { annualExemptAmount: 10100, reportingThreshold: 40400 },
    ratePeriods: [
      { from: "2010-04-06", to: "2010-06-22", basicRate: 18, higherRate: 18 },
      { from: "2010-06-23", to: "2011-04-05", basicRate: 18, higherRate: 28 },
    ],
  },
  {
    taxYear: "2011/12",
    limits: { annualExemptAmount: 10600, reportingThreshold: 42400 },
    ratePeriods: [{ from: "2011-04-06", to: "2012-04-05", basicRate: 18, higherRate: 28 }],
  },
  {
    taxYear: "2012/13",
    limits: { annualExemptAmount: 10600, reportingThreshold: 42400 },
    ratePeriods: [{ from: "2012-04-06", to: "2013-04-05", basicRate: 18, higherRate: 28 }],
  },
  {
    taxYear: "2013/14",
    limits: { annualExemptAmount: 10900, reportingThreshold: 43600 },
    ratePeriods: [{ from: "2013-04-06", to: "2014-04-05", basicRate: 18, higherRate: 28 }],
  },
  {
    taxYear: "2014/15",
    limits: { annualExemptAmount: 11000, reportingThreshold: 44000 },
    ratePeriods: [{ from: "2014-04-06", to: "2015-04-05", basicRate: 18, higherRate: 28 }],
  },
  {
    taxYear: "2015/16",
    limits: { annualExemptAmount: 11100, reportingThreshold: 44400 },
    ratePeriods: [{ from: "2015-04-06", to: "2016-04-05", basicRate: 18, higherRate: 28 }],
  },
  // 2016/17: Rates reduced for shares and securities (10%/20%)
  {
    taxYear: "2016/17",
    limits: { annualExemptAmount: 11100, reportingThreshold: 44400 },
    ratePeriods: [{ from: "2016-04-06", to: "2017-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2017/18",
    limits: { annualExemptAmount: 11300, reportingThreshold: 45200 },
    ratePeriods: [{ from: "2017-04-06", to: "2018-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2018/19",
    limits: { annualExemptAmount: 11700, reportingThreshold: 46800 },
    ratePeriods: [{ from: "2018-04-06", to: "2019-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2019/20",
    limits: { annualExemptAmount: 12000, reportingThreshold: 48000 },
    ratePeriods: [{ from: "2019-04-06", to: "2020-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2020/21",
    limits: { annualExemptAmount: 12300, reportingThreshold: 49200 },
    ratePeriods: [{ from: "2020-04-06", to: "2021-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2021/22",
    limits: { annualExemptAmount: 12300, reportingThreshold: 49200 },
    ratePeriods: [{ from: "2021-04-06", to: "2022-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2022/23",
    limits: { annualExemptAmount: 12300, reportingThreshold: 49200 },
    ratePeriods: [{ from: "2022-04-06", to: "2023-04-05", basicRate: 10, higherRate: 20 }],
  },
  {
    taxYear: "2023/24",
    limits: { annualExemptAmount: 6000, reportingThreshold: 50000 },
    ratePeriods: [{ from: "2023-04-06", to: "2024-04-05", basicRate: 10, higherRate: 20 }],
  },
  // 2024/25: Rates changed on 30 October 2024
  {
    taxYear: "2024/25",
    limits: { annualExemptAmount: 3000, reportingThreshold: 50000 },
    ratePeriods: [
      { from: "2024-04-06", to: "2024-10-29", basicRate: 10, higherRate: 20 },
      { from: "2024-10-30", to: "2025-04-05", basicRate: 18, higherRate: 24 },
    ],
  },
  // 2025/26 onwards: 18%/24%
  {
    taxYear: "2025/26",
    limits: { annualExemptAmount: 3000, reportingThreshold: 50000 },
    ratePeriods: [{ from: "2025-04-06", to: "2026-04-05", basicRate: 18, higherRate: 24 }],
  },
  {
    taxYear: "2026/27",
    limits: { annualExemptAmount: 3000, reportingThreshold: 50000 },
    ratePeriods: [{ from: "2026-04-06", to: "2027-04-05", basicRate: 18, higherRate: 24 }],
  },
];

/**
 * Hydrate an internal config entry into the public CgTaxYearConfig, minting fresh
 * Date objects (and fresh limits/ratePeriods) from the ISO strings. The single
 * boundary between the immutable internal table and the mutable public types, so no
 * value returned to a caller (or baked onto a result by match.ts) ever aliases the table.
 */
function toPublicConfig(internal: InternalTaxYearConfig): CgTaxYearConfig {
  return {
    taxYear: internal.taxYear,
    limits: { ...internal.limits },
    ratePeriods: internal.ratePeriods.map((p) => ({
      from: new Date(p.from),
      to: new Date(p.to),
      basicRate: p.basicRate,
      higherRate: p.higherRate,
    })),
  };
}

/**
 * Returns the HMRC configuration (limits + rate periods) for a UK tax year, or
 * undefined if the year is not configured. Internal: used by the matching engine
 * to resolve a year's AEA, reporting threshold, and rate periods.
 */
export function getTaxYearConfig(taxYear: string): CgTaxYearConfig | undefined {
  const found = taxYearConfig.find((e) => e.taxYear === taxYear);
  return found === undefined ? undefined : toPublicConfig(found);
}

/**
 * Returns the earliest UK tax year ("YYYY/YY") that has bundled HMRC config. The
 * config array is contiguous and ascending, so the first entry is the earliest.
 * Internal: used by input validation to reject trades dated before it.
 */
export function getEarliestSupportedTaxYear(): string {
  return taxYearConfig[0].taxYear;
}

/**
 * Returns the latest UK tax year ("YYYY/YY") that has bundled HMRC config. The
 * config array is contiguous and ascending, so the last entry is the latest.
 * Internal: used by input validation to reject trades dated past it.
 */
export function getLatestSupportedTaxYear(): string {
  return taxYearConfig[taxYearConfig.length - 1].taxYear;
}

/**
 * Earliest trade date accepted by the library — the first day of the earliest
 * supported tax year. Internal single source of truth shared with input validation
 * and getSupportInfo() so the advertised bound can never drift from the enforced one.
 */
export function getMinSupportedDate(): Date {
  const first = taxYearConfig[0];
  return new Date(first.ratePeriods[0].from);
}

/**
 * Latest trade date accepted by the library — the last day of the latest supported
 * tax year. Internal single source of truth shared with getSupportInfo().
 */
export function getMaxSupportedDate(): Date {
  const last = taxYearConfig[taxYearConfig.length - 1];
  return new Date(last.ratePeriods[last.ratePeriods.length - 1].to);
}

/**
 * Returns the full set of HMRC data the library supports, plus the derived bounds a
 * consumer needs without running a calculation: the min/max accepted trade dates, the
 * earliest/latest supported tax years, and every year's limits and rate periods
 * (ascending). Use it to bound a date-picker, look up the CGT rate for a date, or read
 * a year's Annual Exempt Amount. Returns fresh copies — mutating the result is safe and
 * never affects the library's internal config.
 */
export function getSupportInfo(): CgSupportInfo {
  return {
    minDate: getMinSupportedDate(),
    maxDate: getMaxSupportedDate(),
    earliestTaxYear: taxYearConfig[0].taxYear,
    latestTaxYear: taxYearConfig[taxYearConfig.length - 1].taxYear,
    taxYears: taxYearConfig.map(toPublicConfig),
  };
}
