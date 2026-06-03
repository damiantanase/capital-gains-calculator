import { describe, it, expect } from "vitest";
import {
  getTaxYearConfig,
  getSupportInfo,
  getMinSupportedDate,
  getMaxSupportedDate,
  getEarliestSupportedTaxYear,
  getLatestSupportedTaxYear,
} from "../src/hmrc-config";

function d(s: string): Date {
  return new Date(s);
}

describe("getTaxYearConfig", () => {
  it("returns config with rate periods for a known year", () => {
    const config = getTaxYearConfig("2020/21");
    expect(config).toBeDefined();
    expect(config!.limits.annualExemptAmount).toBe(12300);
    expect(config!.ratePeriods).toHaveLength(1);
    expect(config!.ratePeriods[0]).toMatchObject({ basicRate: 10, higherRate: 20 });
  });

  it("returns undefined for unknown year", () => {
    expect(getTaxYearConfig("2007/08")).toBeUndefined();
  });

  it("returns flat 18% rate period for 2008/09", () => {
    const config = getTaxYearConfig("2008/09");
    expect(config!.ratePeriods).toHaveLength(1);
    expect(config!.ratePeriods[0]).toMatchObject({ basicRate: 18, higherRate: 18 });
    expect(config!.ratePeriods[0].from).toEqual(d("2008-04-06"));
    expect(config!.ratePeriods[0].to).toEqual(d("2009-04-05"));
  });

  it("returns reduced rates for 2016/17", () => {
    const config = getTaxYearConfig("2016/17");
    expect(config!.ratePeriods[0]).toMatchObject({ basicRate: 10, higherRate: 20 });
  });

  it("returns 18/24 rates for 2025/26", () => {
    const config = getTaxYearConfig("2025/26");
    expect(config!.ratePeriods[0]).toMatchObject({ basicRate: 18, higherRate: 24 });
  });

  it("has two rate periods for 2024/25 split on 30 October 2024", () => {
    const config = getTaxYearConfig("2024/25");
    expect(config!.ratePeriods).toHaveLength(2);
    expect(config!.ratePeriods[0].from).toEqual(d("2024-04-06"));
    expect(config!.ratePeriods[0].to).toEqual(d("2024-10-29"));
    expect(config!.ratePeriods[0]).toMatchObject({ basicRate: 10, higherRate: 20 });
    expect(config!.ratePeriods[1].from).toEqual(d("2024-10-30"));
    expect(config!.ratePeriods[1].to).toEqual(d("2025-04-05"));
    expect(config!.ratePeriods[1]).toMatchObject({ basicRate: 18, higherRate: 24 });
  });

  it("reports the reporting threshold on a year's limits", () => {
    expect(getTaxYearConfig("2008/09")!.limits.reportingThreshold).toBe(38400);
    expect(getTaxYearConfig("2014/15")!.limits.reportingThreshold).toBe(44000);
    expect(getTaxYearConfig("2024/25")!.limits.reportingThreshold).toBe(50000);
  });
});

describe("getSupportInfo", () => {
  it("reports the supported date range derived from the config bounds", () => {
    const info = getSupportInfo();
    expect(info.minDate).toEqual(d("2008-04-06"));
    expect(info.maxDate).toEqual(d("2027-04-05"));
    expect(info.earliestTaxYear).toBe("2008/09");
    expect(info.latestTaxYear).toBe("2026/27");
  });

  it("matches the internal min/max date and earliest/latest-year helpers", () => {
    const info = getSupportInfo();
    expect(info.minDate).toEqual(getMinSupportedDate());
    expect(info.maxDate).toEqual(getMaxSupportedDate());
    expect(info.earliestTaxYear).toBe(getEarliestSupportedTaxYear());
    expect(info.latestTaxYear).toBe(getLatestSupportedTaxYear());
  });

  it("returns every supported year, ascending and contiguous", () => {
    const years = getSupportInfo().taxYears;
    expect(years[0].taxYear).toBe("2008/09");
    expect(years[years.length - 1].taxYear).toBe("2026/27");
    for (let i = 1; i < years.length; i++) {
      // Each year's first rate period starts the day after the previous year ends.
      const prevEnd = years[i - 1].ratePeriods[years[i - 1].ratePeriods.length - 1].to.getTime();
      const thisStart = years[i].ratePeriods[0].from.getTime();
      expect(thisStart - prevEnd).toBe(86_400_000);
    }
  });

  it("carries each year's limits and rate periods (e.g. the 2024/25 split)", () => {
    const y2024 = getSupportInfo().taxYears.find((y) => y.taxYear === "2024/25");
    expect(y2024!.limits.annualExemptAmount).toBe(3000);
    expect(y2024!.ratePeriods).toHaveLength(2);
    expect(y2024!.ratePeriods[1]).toMatchObject({ basicRate: 18, higherRate: 24 });
  });

  it("returns fresh copies — mutating the result never affects later calls", () => {
    const first = getSupportInfo();
    first.minDate.setUTCFullYear(1999);
    first.taxYears[0].limits.annualExemptAmount = -1;
    first.taxYears[0].ratePeriods[0].basicRate = 99;

    const second = getSupportInfo();
    expect(second.minDate).toEqual(d("2008-04-06"));
    expect(second.taxYears[0].limits.annualExemptAmount).toBe(9600);
    expect(second.taxYears[0].ratePeriods[0].basicRate).toBe(18);
  });
});

describe("getTaxYearConfig immutability", () => {
  it("returns a fresh, independent config object on each call", () => {
    const a = getTaxYearConfig("2020/21");
    const b = getTaxYearConfig("2020/21");
    // Same values...
    expect(a).toEqual(b);
    // ...but distinct objects all the way down (no shared references with the table).
    expect(a).not.toBe(b);
    expect(a!.limits).not.toBe(b!.limits);
    expect(a!.ratePeriods).not.toBe(b!.ratePeriods);
    expect(a!.ratePeriods[0]).not.toBe(b!.ratePeriods[0]);
    expect(a!.ratePeriods[0].from).not.toBe(b!.ratePeriods[0].from);
  });

  it("mutating a returned config never corrupts the internal table", () => {
    const first = getTaxYearConfig("2020/21");
    first!.limits.annualExemptAmount = -1;
    first!.ratePeriods[0].basicRate = 99;
    first!.ratePeriods[0].from.setUTCFullYear(1999);

    const second = getTaxYearConfig("2020/21");
    expect(second!.limits.annualExemptAmount).toBe(12300);
    expect(second!.ratePeriods[0].basicRate).toBe(10);
    expect(second!.ratePeriods[0].from).toEqual(d("2020-04-06"));
  });
});
