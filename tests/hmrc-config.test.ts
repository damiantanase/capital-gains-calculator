import { describe, it, expect } from "vitest";
import {
  getDefaultAllowances,
  getReportingThresholds,
  getAllTaxYears,
  getTaxYearConfig,
  getAllTaxYearConfigs,
  getRatesForDate,
} from "../src/hmrc-config";

describe("getDefaultAllowances", () => {
  it("returns a map with all tax years from 2008/09", () => {
    const allowances = getDefaultAllowances();
    expect(allowances["2008/09"]).toBe(9600);
    expect(allowances["2009/10"]).toBe(10100);
    expect(allowances["2010/11"]).toBe(10100);
    expect(allowances["2013/14"]).toBe(10900);
    expect(allowances["2014/15"]).toBe(11000);
    expect(allowances["2020/21"]).toBe(12300);
    expect(allowances["2023/24"]).toBe(6000);
    expect(allowances["2024/25"]).toBe(3000);
    expect(allowances["2026/27"]).toBe(3000);
  });

  it("covers all years from 2008/09 to 2026/27", () => {
    const allowances = getDefaultAllowances();
    expect(Object.keys(allowances).length).toBe(19);
  });
});

describe("getAllTaxYears", () => {
  it("starts at 2008/09", () => {
    const years = getAllTaxYears();
    expect(years[0]).toBe("2008/09");
  });

  it("ends at 2026/27", () => {
    const years = getAllTaxYears();
    expect(years[years.length - 1]).toBe("2026/27");
  });
});

describe("getTaxYearConfig", () => {
  it("returns config with rate periods for a known year", () => {
    const config = getTaxYearConfig("2020/21");
    expect(config).toBeDefined();
    expect(config!.annualExemptAmount).toBe(12300);
    expect(config!.ratePeriods).toHaveLength(1);
    expect(config!.ratePeriods[0].rates).toEqual({ basic: 10, higher: 20 });
  });

  it("returns undefined for unknown year", () => {
    expect(getTaxYearConfig("2007/08")).toBeUndefined();
  });

  it("returns flat 18% rate period for 2008/09", () => {
    const config = getTaxYearConfig("2008/09");
    expect(config!.ratePeriods).toHaveLength(1);
    expect(config!.ratePeriods[0]).toEqual({
      from: "2008-04-06",
      to: "2009-04-05",
      rates: { basic: 18, higher: 18 },
    });
  });

  it("returns two-tier rates for 2010/11", () => {
    const config = getTaxYearConfig("2010/11");
    expect(config!.ratePeriods[0].rates).toEqual({ basic: 18, higher: 28 });
  });

  it("returns reduced rates for 2016/17", () => {
    const config = getTaxYearConfig("2016/17");
    expect(config!.ratePeriods[0].rates).toEqual({ basic: 10, higher: 20 });
  });

  it("returns 18/24 rates for 2025/26", () => {
    const config = getTaxYearConfig("2025/26");
    expect(config!.ratePeriods[0].rates).toEqual({ basic: 18, higher: 24 });
  });

  it("has two rate periods for 2024/25", () => {
    const config = getTaxYearConfig("2024/25");
    expect(config!.ratePeriods).toHaveLength(2);
    expect(config!.ratePeriods[0]).toEqual({
      from: "2024-04-06",
      to: "2024-10-29",
      rates: { basic: 10, higher: 20 },
    });
    expect(config!.ratePeriods[1]).toEqual({
      from: "2024-10-30",
      to: "2025-04-05",
      rates: { basic: 18, higher: 24 },
    });
  });
});

describe("getRatesForDate", () => {
  it("returns 10/20 rates for disposal in 2020/21", () => {
    expect(getRatesForDate("2020-06-15")).toEqual({ basic: 10, higher: 20 });
  });

  it("returns flat 18% for any date in 2008/09", () => {
    expect(getRatesForDate("2008-10-01")).toEqual({ basic: 18, higher: 18 });
  });

  it("returns 10/20 for 2024/25 before October 30", () => {
    expect(getRatesForDate("2024-06-15")).toEqual({ basic: 10, higher: 20 });
    expect(getRatesForDate("2024-10-29")).toEqual({ basic: 10, higher: 20 });
  });

  it("returns 18/24 for 2024/25 from October 30", () => {
    expect(getRatesForDate("2024-10-30")).toEqual({ basic: 18, higher: 24 });
    expect(getRatesForDate("2024-12-01")).toEqual({ basic: 18, higher: 24 });
    expect(getRatesForDate("2025-03-15")).toEqual({ basic: 18, higher: 24 });
  });

  it("returns 18/24 for 2025/26", () => {
    expect(getRatesForDate("2025-06-15")).toEqual({ basic: 18, higher: 24 });
  });

  it("returns undefined for dates outside supported range", () => {
    expect(getRatesForDate("2007-06-15")).toBeUndefined();
  });

  it("handles tax year boundaries correctly", () => {
    expect(getRatesForDate("2025-04-05")).toEqual({ basic: 18, higher: 24 });
    expect(getRatesForDate("2025-04-06")).toEqual({ basic: 18, higher: 24 });
  });
});

describe("getAllTaxYearConfigs", () => {
  it("returns a copy of the config array", () => {
    const configs = getAllTaxYearConfigs();
    expect(configs.length).toBe(19);
    expect(configs[0].taxYear).toBe("2008/09");
    expect(configs[configs.length - 1].taxYear).toBe("2026/27");
  });
});

describe("getReportingThresholds", () => {
  it("returns 4x AEA for early years", () => {
    const thresholds = getReportingThresholds();
    expect(thresholds["2008/09"]).toBe(38400);
    expect(thresholds["2014/15"]).toBe(44000);
  });

  it("returns 50000 for recent years", () => {
    const thresholds = getReportingThresholds();
    expect(thresholds["2024/25"]).toBe(50000);
  });
});
