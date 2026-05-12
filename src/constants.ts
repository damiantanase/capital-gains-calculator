/** Tolerance for floating-point comparison of share quantities. Avoids false positives from rounding after split adjustments. */
export const SHARE_TOLERANCE = 0.0001;

export function getTaxYearForDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  let startYear = year;

  if (month < 4 || (month === 4 && day <= 5)) {
    startYear -= 1;
  }

  const endYearShort = String(startYear + 1).slice(-2);
  return `${startYear}/${endYearShort}`;
}

export function getCurrentTaxYear(): string {
  return getTaxYearForDate(new Date().toISOString().slice(0, 10));
}
