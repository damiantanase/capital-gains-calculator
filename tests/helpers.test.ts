import { describe, it, expect } from "vitest";
import { getTaxYearForDate, getCurrentTaxYear } from "../src/helpers";

function d(s: string): Date {
  return new Date(s);
}

describe("getTaxYearForDate", () => {
  it("returns correct tax year for date after April 5", () => {
    expect(getTaxYearForDate(d("2023-04-06"))).toBe("2023/24");
    expect(getTaxYearForDate(d("2023-07-15"))).toBe("2023/24");
    expect(getTaxYearForDate(d("2023-12-25"))).toBe("2023/24");
    expect(getTaxYearForDate(d("2024-03-01"))).toBe("2023/24");
  });

  it("returns previous tax year for date on or before April 5", () => {
    expect(getTaxYearForDate(d("2024-04-05"))).toBe("2023/24");
    expect(getTaxYearForDate(d("2024-01-01"))).toBe("2023/24");
    expect(getTaxYearForDate(d("2024-03-31"))).toBe("2023/24");
  });

  it("handles the exact boundary (April 5 vs April 6)", () => {
    expect(getTaxYearForDate(d("2025-04-05"))).toBe("2024/25");
    expect(getTaxYearForDate(d("2025-04-06"))).toBe("2025/26");
  });

  it("formats tax year as YYYY/YY", () => {
    const result = getTaxYearForDate(d("2022-06-01"));
    expect(result).toMatch(/^\d{4}\/\d{2}$/);
    expect(result).toBe("2022/23");
  });

  it("handles century boundary", () => {
    expect(getTaxYearForDate(d("2099-06-01"))).toBe("2099/00");
  });
});

describe("getCurrentTaxYear", () => {
  it("returns a valid tax year format", () => {
    const result = getCurrentTaxYear();
    expect(result).toMatch(/^\d{4}\/\d{2}$/);
  });
});
