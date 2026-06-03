# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | Yes       |
| < 2.0   | No        |

Only the latest released version receives security patches.

## Reporting a Vulnerability

To report a vulnerability or calculation bug that could lead to incorrect tax filings, please use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) via the **Security** tab of this repository.

**Calculation bugs that could result in incorrect tax filings are treated as security-grade issues** and will be prioritised accordingly.

Reports are handled on a best-effort basis.

## Scope

- Incorrect HMRC share matching logic (same-day, B&B, Section 104)
- Numerical errors in gain/loss calculations
- Incorrect tax year assignments
- Incorrect rate or allowance values
- Any issue that could cause a user to under-report or over-report to HMRC
