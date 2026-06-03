// =============================================================================
// Public date utilities
//
// Consumer-facing UK tax-year helpers (re-exported from index.ts). UK tax-year
// logic interprets dates using UTC components so results never depend on the
// host timezone. Derived calculation values (cost, gain, tax, pool impact) are
// baked onto the output types by the engine — see src/types/outputs.ts — so
// consumers read fields rather than calling helpers.
// =============================================================================

/** Returns the UK tax year ("YYYY/YY") that a date falls in (6 April to 5 April). */
export function getTaxYearForDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  let startYear = year;

  if (month < 4 || (month === 4 && day <= 5)) {
    startYear -= 1;
  }

  const endYearShort = String(startYear + 1).slice(-2);
  return `${startYear}/${endYearShort}`;
}

/** Returns the current UK tax year ("YYYY/YY"). */
export function getCurrentTaxYear(): string {
  return getTaxYearForDate(new Date());
}
