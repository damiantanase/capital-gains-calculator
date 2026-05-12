export interface CgtRateBand {
  basic: number;
  higher: number;
}

export interface CgtRatePeriod {
  from: string;
  to: string;
  rates: CgtRateBand;
}

export interface TaxYearConfig {
  taxYear: string;
  annualExemptAmount: number;
  reportingThreshold: number;
  ratePeriods: CgtRatePeriod[];
}

const taxYearConfig: TaxYearConfig[] = [
  // 2008/09–2009/10: Flat 18% rate for all gains
  {
    taxYear: "2008/09",
    annualExemptAmount: 9600,
    reportingThreshold: 38400,
    ratePeriods: [{ from: "2008-04-06", to: "2009-04-05", rates: { basic: 18, higher: 18 } }],
  },
  {
    taxYear: "2009/10",
    annualExemptAmount: 10100,
    reportingThreshold: 40400,
    ratePeriods: [{ from: "2009-04-06", to: "2010-04-05", rates: { basic: 18, higher: 18 } }],
  },
  // 2010/11: Two-tier rates introduced (18%/28%)
  {
    taxYear: "2010/11",
    annualExemptAmount: 10100,
    reportingThreshold: 40400,
    ratePeriods: [{ from: "2010-04-06", to: "2011-04-05", rates: { basic: 18, higher: 28 } }],
  },
  {
    taxYear: "2011/12",
    annualExemptAmount: 10600,
    reportingThreshold: 42400,
    ratePeriods: [{ from: "2011-04-06", to: "2012-04-05", rates: { basic: 18, higher: 28 } }],
  },
  {
    taxYear: "2012/13",
    annualExemptAmount: 10600,
    reportingThreshold: 42400,
    ratePeriods: [{ from: "2012-04-06", to: "2013-04-05", rates: { basic: 18, higher: 28 } }],
  },
  {
    taxYear: "2013/14",
    annualExemptAmount: 10900,
    reportingThreshold: 43600,
    ratePeriods: [{ from: "2013-04-06", to: "2014-04-05", rates: { basic: 18, higher: 28 } }],
  },
  {
    taxYear: "2014/15",
    annualExemptAmount: 11000,
    reportingThreshold: 44000,
    ratePeriods: [{ from: "2014-04-06", to: "2015-04-05", rates: { basic: 18, higher: 28 } }],
  },
  {
    taxYear: "2015/16",
    annualExemptAmount: 11100,
    reportingThreshold: 44400,
    ratePeriods: [{ from: "2015-04-06", to: "2016-04-05", rates: { basic: 18, higher: 28 } }],
  },
  // 2016/17: Rates reduced for shares and securities (10%/20%)
  {
    taxYear: "2016/17",
    annualExemptAmount: 11100,
    reportingThreshold: 44400,
    ratePeriods: [{ from: "2016-04-06", to: "2017-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2017/18",
    annualExemptAmount: 11300,
    reportingThreshold: 45200,
    ratePeriods: [{ from: "2017-04-06", to: "2018-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2018/19",
    annualExemptAmount: 11700,
    reportingThreshold: 46800,
    ratePeriods: [{ from: "2018-04-06", to: "2019-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2019/20",
    annualExemptAmount: 12000,
    reportingThreshold: 48000,
    ratePeriods: [{ from: "2019-04-06", to: "2020-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2020/21",
    annualExemptAmount: 12300,
    reportingThreshold: 49200,
    ratePeriods: [{ from: "2020-04-06", to: "2021-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2021/22",
    annualExemptAmount: 12300,
    reportingThreshold: 49200,
    ratePeriods: [{ from: "2021-04-06", to: "2022-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2022/23",
    annualExemptAmount: 12300,
    reportingThreshold: 49200,
    ratePeriods: [{ from: "2022-04-06", to: "2023-04-05", rates: { basic: 10, higher: 20 } }],
  },
  {
    taxYear: "2023/24",
    annualExemptAmount: 6000,
    reportingThreshold: 50000,
    ratePeriods: [{ from: "2023-04-06", to: "2024-04-05", rates: { basic: 10, higher: 20 } }],
  },
  // 2024/25: Rates changed on 30 October 2024
  {
    taxYear: "2024/25",
    annualExemptAmount: 3000,
    reportingThreshold: 50000,
    ratePeriods: [
      { from: "2024-04-06", to: "2024-10-29", rates: { basic: 10, higher: 20 } },
      { from: "2024-10-30", to: "2025-04-05", rates: { basic: 18, higher: 24 } },
    ],
  },
  // 2025/26 onwards: 18%/24%
  {
    taxYear: "2025/26",
    annualExemptAmount: 3000,
    reportingThreshold: 50000,
    ratePeriods: [{ from: "2025-04-06", to: "2026-04-05", rates: { basic: 18, higher: 24 } }],
  },
  {
    taxYear: "2026/27",
    annualExemptAmount: 3000,
    reportingThreshold: 50000,
    ratePeriods: [{ from: "2026-04-06", to: "2027-04-05", rates: { basic: 18, higher: 24 } }],
  },
];

export function getDefaultAllowances(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of taxYearConfig) {
    result[entry.taxYear] = entry.annualExemptAmount;
  }
  return result;
}

export function getReportingThresholds(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of taxYearConfig) {
    result[entry.taxYear] = entry.reportingThreshold;
  }
  return result;
}

export function getAllTaxYears(): string[] {
  return taxYearConfig.map((e) => e.taxYear).sort();
}

export function getTaxYearConfig(taxYear: string): TaxYearConfig | undefined {
  return taxYearConfig.find((e) => e.taxYear === taxYear);
}

export function getAllTaxYearConfigs(): TaxYearConfig[] {
  return [...taxYearConfig];
}

/**
 * Returns the applicable CGT rates for a disposal of shares/securities on a given date.
 */
export function getRatesForDate(date: string): CgtRateBand | undefined {
  for (const year of taxYearConfig) {
    for (const period of year.ratePeriods) {
      if (date >= period.from && date <= period.to) {
        return period.rates;
      }
    }
  }
  return undefined;
}
