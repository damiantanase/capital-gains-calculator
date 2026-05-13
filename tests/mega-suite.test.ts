import { describe, it, expect } from "vitest";
import { calculateCgt } from "../src/calculator";
import type { CgtTradeInput } from "../src/trade";
import type { SplitEvent, CgtResult } from "../src/types";

// ---------------------------------------------------------------------------
// Mega-suite: ~500 trades covering all realistic UK CGT edge cases
// ---------------------------------------------------------------------------
//
// Scenarios covered:
//   1.  Basic section 104 pool (multiple symbols, years of accumulation)
//   2.  Same-day matching (12 instances across VOD, AAPL, MSFT, GOOGL, TSLA,
//       AMZN, NVDA, LLOY, BP)
//   3.  Bed & breakfast rule (10 instances within 30 days)
//   4.  B&B at exactly day 30 (SHEL 2018-07-01 / 2018-07-31)
//   5.  B&B at day 31 — NOT triggered (VOD 2018-08-15 / 2018-09-15,
//       VOD 2025-01-20 / 2025-02-20)
//   6.  Multiple buys on same day composited (SHEL, AAPL, BP)
//   7.  Partial disposals (many)
//   8.  Full disposal then rebuy (TSLA 2019-06-01)
//   9.  Stock splits: AAPL 1:4, AMZN 1:20, GOOGL 1:20, TSLA 1:3, NVDA 1:10
//   10. Foreign currency (USD trades with 1.20-1.35 exchange rates)
//   11. GBP trades (SHEL, BP, VOD, LLOY — no FX conversion)
//   12. Trades with fees (5, 9.99, 11.95, 12.50, 25 GBP)
//   13. Trades with zero fees
//   14. Gains (many)
//   15. Losses (COVID crash, bad timing)
//   16. Transfers — gift to spouse (5 instances: LLOY, BP, VOD, SHEL, GOOGL)
//   17. Multiple tax years (2008/09 through 2025/26 — 18 years)
//   18. Trades near tax year boundary (April 5 and April 6)
//   19. Trades near B&B boundary (day 28, 29, 30, 31)
//   20. Large quantities (10,000+ shares)
//   21. Small quantities (1-5 shares)
//   22. High-priced stocks (AMZN pre-split $3,100+, NVDA $1,200+)
//   23. Low-priced stocks (LLOY 0.28-0.65 GBP, VOD 0.80-1.30 GBP)
//   24. Multiple sells on same day different symbols
//   25. Accumulation over years (DCA-style buying)
//   26. 2024/25 split rate period (pre/post 30 Oct 2024)
//

const splitEvents: SplitEvent[] = [
  { date: "2020-08-31", symbol: "AAPL", ratioFrom: 1, ratioTo: 4 },
  { date: "2022-06-06", symbol: "AMZN", ratioFrom: 1, ratioTo: 20 },
  { date: "2022-07-18", symbol: "GOOGL", ratioFrom: 1, ratioTo: 20 },
  { date: "2022-08-25", symbol: "TSLA", ratioFrom: 1, ratioTo: 3 },
  { date: "2024-06-10", symbol: "NVDA", ratioFrom: 1, ratioTo: 10 },
];

const trades: CgtTradeInput[] = [
  // --- 2008/09 tax year ---
  {
    date: "2008-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 1.45,
    allowableExpenditure: 12.5,
  },
  {
    date: "2008-06-01",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 5.8,
    allowableExpenditure: 12.5,
  },
  {
    date: "2008-09-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 18.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2008-11-01",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.2,
    allowableExpenditure: 12.5,
  },
  {
    date: "2009-01-10",
    symbol: "LLOY",
    type: "buy",
    quantity: 10000,
    unitPrice: 0.9,
    allowableExpenditure: 11.95,
  },
  {
    date: "2009-02-15",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.95,
    allowableExpenditure: 9.99,
  },
  // --- 2009/10 tax year ---
  {
    date: "2009-05-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.65,
    allowableExpenditure: 0,
  },
  {
    date: "2009-06-15",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 1.25,
    allowableExpenditure: 9.99,
  },
  {
    date: "2009-08-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 16.4,
    allowableExpenditure: 9.99,
  },
  {
    date: "2009-10-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.85,
    allowableExpenditure: 11.95,
  },
  {
    date: "2009-12-01",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.6,
    allowableExpenditure: 9.99,
  },
  {
    date: "2010-02-10",
    symbol: "VOD",
    type: "sell",
    quantity: 1500,
    unitPrice: 1.4,
    allowableExpenditure: 9.99,
  },
  // --- 2010/11 tax year ---
  {
    date: "2010-04-15",
    symbol: "BP",
    type: "buy",
    quantity: 5000,
    unitPrice: 6.3,
    allowableExpenditure: 12.5,
  },
  {
    date: "2010-06-01",
    symbol: "BP",
    type: "sell",
    quantity: 2000,
    unitPrice: 3.5,
    allowableExpenditure: 12.5,
  },
  {
    date: "2010-07-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 150,
    unitPrice: 17.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2010-09-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 8000,
    unitPrice: 0.62,
    allowableExpenditure: 0,
  },
  {
    date: "2010-11-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 1.65,
    allowableExpenditure: 9.99,
  },
  {
    date: "2011-01-10",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.7,
    allowableExpenditure: 11.95,
  },
  {
    date: "2011-03-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 21.5,
    allowableExpenditure: 9.99,
  },
  // --- 2011/12 tax year ---
  {
    date: "2011-05-01",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 1.72,
    allowableExpenditure: 9.99,
  },
  {
    date: "2011-06-15",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 4.4,
    allowableExpenditure: 12.5,
  },
  {
    date: "2011-08-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 10000,
    unitPrice: 0.38,
    allowableExpenditure: 0,
  },
  {
    date: "2011-09-15",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 1.68,
    allowableExpenditure: 9.99,
  },
  {
    date: "2011-11-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 100,
    unitPrice: 22.3,
    allowableExpenditure: 9.99,
  },
  {
    date: "2012-01-20",
    symbol: "BP",
    type: "sell",
    quantity: 3000,
    unitPrice: 4.8,
    allowableExpenditure: 12.5,
  },
  // --- 2012/13 tax year ---
  {
    date: "2012-05-10",
    symbol: "LLOY",
    type: "sell",
    quantity: 8000,
    unitPrice: 0.32,
    allowableExpenditure: 11.95,
  },
  {
    date: "2012-06-01",
    symbol: "VOD",
    type: "buy",
    quantity: 2500,
    unitPrice: 1.78,
    allowableExpenditure: 9.99,
  },
  {
    date: "2012-08-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 21.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2012-10-01",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 4.35,
    allowableExpenditure: 12.5,
  },
  {
    date: "2012-12-10",
    symbol: "VOD",
    type: "sell",
    quantity: 1500,
    unitPrice: 1.7,
    allowableExpenditure: 9.99,
  },
  {
    date: "2013-02-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 12000,
    unitPrice: 0.48,
    allowableExpenditure: 0,
  },
  // --- 2013/14 tax year ---
  {
    date: "2013-05-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 150,
    unitPrice: 22.6,
    allowableExpenditure: 9.99,
  },
  {
    date: "2013-06-15",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 4.75,
    allowableExpenditure: 12.5,
  },
  {
    date: "2013-08-01",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 2.05,
    allowableExpenditure: 9.99,
  },
  {
    date: "2013-09-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.72,
    allowableExpenditure: 11.95,
  },
  {
    date: "2013-09-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.73,
    allowableExpenditure: 11.95,
  },
  {
    date: "2013-11-01",
    symbol: "BP",
    type: "sell",
    quantity: 2000,
    unitPrice: 4.9,
    allowableExpenditure: 12.5,
  },
  {
    date: "2014-01-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 250,
    unitPrice: 22.8,
    allowableExpenditure: 9.99,
  },
  // --- 2014/15 tax year ---
  {
    date: "2014-04-10",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 2.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2014-06-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 8000,
    unitPrice: 0.75,
    allowableExpenditure: 0,
  },
  {
    date: "2014-08-15",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 4.95,
    allowableExpenditure: 12.5,
  },
  {
    date: "2014-09-01",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.85,
    allowableExpenditure: 12.5,
  },
  {
    date: "2014-09-20",
    symbol: "BP",
    type: "buy",
    quantity: 500,
    unitPrice: 4.7,
    allowableExpenditure: 12.5,
  },
  {
    date: "2014-11-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 23.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-01-10",
    symbol: "VOD",
    type: "buy",
    quantity: 4000,
    unitPrice: 2.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-03-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 10000,
    unitPrice: 0.8,
    allowableExpenditure: 11.95,
  },
  // --- 2015/16 tax year onwards (original data) ---
  {
    date: "2015-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 2.15,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-04-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 100,
    unitPrice: 26.2,
    allowableExpenditure: 5,
  },
  {
    date: "2015-04-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 30,
    unitPrice: 22,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2015-05-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 5,
    unitPrice: 430,
    allowableExpenditure: 12.5,
    exchangeRate: 1.33,
  },
  {
    date: "2015-05-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 2.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-05-20",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 4.75,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-06-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 500,
    unitPrice: 26.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-06-15",
    symbol: "BP",
    type: "buy",
    quantity: 3000,
    unitPrice: 4.85,
    allowableExpenditure: 12.5,
  },
  {
    date: "2015-07-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 265,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2015-07-10",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 270,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2015-07-20",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 2.1,
    allowableExpenditure: 11.95,
  },
  {
    date: "2015-08-10",
    symbol: "AAPL",
    type: "buy",
    quantity: 20,
    unitPrice: 115,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2015-08-20",
    symbol: "TSLA",
    type: "buy",
    quantity: 3,
    unitPrice: 240,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2015-09-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 15,
    unitPrice: 630,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2015-09-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.55,
    allowableExpenditure: 0,
  },
  {
    date: "2015-09-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 510,
    allowableExpenditure: 12.5,
    exchangeRate: 1.32,
  },
  {
    date: "2015-10-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 230,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2015-10-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.52,
    allowableExpenditure: 0,
  },
  {
    date: "2015-10-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 1000,
    unitPrice: 0.56,
    allowableExpenditure: 0,
  },
  {
    date: "2015-11-01",
    symbol: "LLOY",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.56,
    allowableExpenditure: 0,
  },
  {
    date: "2015-11-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 25.8,
    allowableExpenditure: 5,
  },
  {
    date: "2015-11-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.48,
    allowableExpenditure: 0,
  },
  {
    date: "2015-11-20",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.9,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-12-01",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 2.3,
    allowableExpenditure: 9.99,
  },
  {
    date: "2015-12-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 5,
    unitPrice: 750,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2015-12-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 25,
    unitPrice: 32,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2016-01-05",
    symbol: "MSFT",
    type: "buy",
    quantity: 3,
    unitPrice: 280,
    allowableExpenditure: 5,
    exchangeRate: 1.32,
  },
  {
    date: "2016-01-10",
    symbol: "AAPL",
    type: "buy",
    quantity: 10,
    unitPrice: 105,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2016-01-20",
    symbol: "TSLA",
    type: "buy",
    quantity: 2,
    unitPrice: 210,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2016-01-25",
    symbol: "GOOGL",
    type: "buy",
    quantity: 3,
    unitPrice: 710,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2016-02-01",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 4.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-02-10",
    symbol: "VOD",
    type: "buy",
    quantity: 800,
    unitPrice: 2.05,
    allowableExpenditure: 0,
  },
  {
    date: "2016-02-15",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 2.12,
    allowableExpenditure: 0,
  },
  {
    date: "2016-02-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.51,
    allowableExpenditure: 0,
  },
  {
    date: "2016-03-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.5,
    allowableExpenditure: 0,
  },
  {
    date: "2016-03-10",
    symbol: "AAPL",
    type: "buy",
    quantity: 5,
    unitPrice: 100,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2016-03-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 30,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2016-03-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 26.8,
    allowableExpenditure: 5,
  },
  {
    date: "2016-04-05",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 4.6,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-04-06",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 4.55,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-04-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 600,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2016-05-10",
    symbol: "VOD",
    type: "buy",
    quantity: 800,
    unitPrice: 2.05,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-05-10",
    symbol: "VOD",
    type: "sell",
    quantity: 800,
    unitPrice: 2.15,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-05-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 15,
    unitPrice: 42,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2016-06-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 25.8,
    allowableExpenditure: 5,
  },
  {
    date: "2016-06-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 25.9,
    allowableExpenditure: 5,
  },
  {
    date: "2016-06-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 400,
    unitPrice: 26.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-06-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.5,
    allowableExpenditure: 0,
  },
  {
    date: "2016-06-20",
    symbol: "VOD",
    type: "sell",
    quantity: 300,
    unitPrice: 2.12,
    allowableExpenditure: 0,
  },
  {
    date: "2016-07-01",
    symbol: "VOD",
    type: "sell",
    quantity: 1500,
    unitPrice: 2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-07-10",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2016-07-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 1.95,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-07-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 150,
    unitPrice: 26,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-08-01",
    symbol: "BP",
    type: "sell",
    quantity: 1000,
    unitPrice: 4.2,
    allowableExpenditure: 12.5,
  },
  {
    date: "2016-08-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 2,
    allowableExpenditure: 0,
  },
  {
    date: "2016-08-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 3,
    unitPrice: 780,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2016-09-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 10,
    unitPrice: 770,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2016-09-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 68,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2016-09-20",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.7,
    allowableExpenditure: 9.99,
  },
  {
    date: "2016-10-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 20,
    unitPrice: 300,
    allowableExpenditure: 11.95,
    exchangeRate: 1.3,
  },
  {
    date: "2016-10-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.56,
    allowableExpenditure: 0,
  },
  {
    date: "2016-10-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 5,
    unitPrice: 117,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2016-11-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 15000,
    unitPrice: 0.54,
    allowableExpenditure: 0,
  },
  {
    date: "2016-11-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 8,
    unitPrice: 110,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2016-11-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 100,
    unitPrice: 26.1,
    allowableExpenditure: 5,
  },
  {
    date: "2016-12-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 10,
    unitPrice: 118,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2016-12-01",
    symbol: "AAPL",
    type: "sell",
    quantity: 10,
    unitPrice: 118.5,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2016-12-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 5,
    unitPrice: 790,
    allowableExpenditure: 12.5,
    exchangeRate: 1.26,
  },
  {
    date: "2016-12-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 1500,
    unitPrice: 0.55,
    allowableExpenditure: 0,
  },
  {
    date: "2017-01-15",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 4.9,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-01-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 295,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2017-02-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 290,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2017-02-20",
    symbol: "VOD",
    type: "buy",
    quantity: 500,
    unitPrice: 2.1,
    allowableExpenditure: 0,
  },
  {
    date: "2017-03-01",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 2.08,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-03-10",
    symbol: "NVDA",
    type: "sell",
    quantity: 10,
    unitPrice: 98,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2017-03-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 8,
    unitPrice: 250,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2017-04-10",
    symbol: "NVDA",
    type: "buy",
    quantity: 50,
    unitPrice: 105,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2017-04-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 4,
    unitPrice: 910,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2017-04-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.62,
    allowableExpenditure: 0,
  },
  {
    date: "2017-05-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 310,
    allowableExpenditure: 11.95,
    exchangeRate: 1.29,
  },
  {
    date: "2017-05-10",
    symbol: "AMZN",
    type: "sell",
    quantity: 2,
    unitPrice: 950,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2017-05-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.63,
    allowableExpenditure: 0,
  },
  {
    date: "2017-06-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 300,
    unitPrice: 27.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-06-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 2.18,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-06-20",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.15,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-07-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 27,
    allowableExpenditure: 5,
  },
  {
    date: "2017-07-15",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 2.25,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-07-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.6,
    allowableExpenditure: 0,
  },
  {
    date: "2017-07-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 8,
    unitPrice: 150,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2017-08-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 15,
    unitPrice: 310,
    allowableExpenditure: 5,
    exchangeRate: 1.31,
  },
  {
    date: "2017-08-01",
    symbol: "MSFT",
    type: "sell",
    quantity: 15,
    unitPrice: 315,
    allowableExpenditure: 5,
    exchangeRate: 1.31,
  },
  {
    date: "2017-08-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 340,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2017-08-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 27.2,
    allowableExpenditure: 5,
  },
  {
    date: "2017-09-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 10,
    unitPrice: 940,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2017-09-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 4,
    unitPrice: 330,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2017-10-01",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.62,
    allowableExpenditure: 0,
  },
  {
    date: "2017-10-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 15,
    unitPrice: 190,
    allowableExpenditure: 5,
    exchangeRate: 1.32,
  },
  {
    date: "2017-10-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.58,
    allowableExpenditure: 0,
  },
  {
    date: "2017-10-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 300,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2017-11-01",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 5.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-11-15",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 5.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2017-11-20",
    symbol: "VOD",
    type: "sell",
    quantity: 300,
    unitPrice: 2.2,
    allowableExpenditure: 0,
  },
  {
    date: "2017-12-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 400,
    unitPrice: 26.2,
    allowableExpenditure: 11.95,
  },
  {
    date: "2017-12-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 10,
    unitPrice: 170,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2017-12-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 3,
    unitPrice: 1055,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2018-01-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 5,
    unitPrice: 1060,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2018-01-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 30,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2018-01-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 1310,
    allowableExpenditure: 12.5,
    exchangeRate: 1.35,
  },
  {
    date: "2018-02-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 15,
    unitPrice: 165,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2018-02-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 8,
    unitPrice: 310,
    allowableExpenditure: 11.95,
    exchangeRate: 1.35,
  },
  {
    date: "2018-02-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 1500,
    unitPrice: 0.61,
    allowableExpenditure: 0,
  },
  {
    date: "2018-03-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 5,
    unitPrice: 1500,
    allowableExpenditure: 12.5,
    exchangeRate: 1.33,
  },
  {
    date: "2018-03-10",
    symbol: "NVDA",
    type: "buy",
    quantity: 10,
    unitPrice: 235,
    allowableExpenditure: 5,
    exchangeRate: 1.34,
  },
  {
    date: "2018-03-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.6,
    allowableExpenditure: 0,
  },
  {
    date: "2018-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 1.95,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-04-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 1600,
    allowableExpenditure: 12.5,
    exchangeRate: 1.33,
  },
  {
    date: "2018-04-25",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 1.92,
    allowableExpenditure: 0,
  },
  {
    date: "2018-05-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 20,
    unitPrice: 290,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2018-05-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 4000,
    unitPrice: 0.58,
    allowableExpenditure: 0,
  },
  {
    date: "2018-05-20",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 5.45,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-06-01",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.5,
    allowableExpenditure: 12.5,
  },
  {
    date: "2018-06-01",
    symbol: "BP",
    type: "sell",
    quantity: 1000,
    unitPrice: 5.65,
    allowableExpenditure: 12.5,
  },
  {
    date: "2018-06-15",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 1.9,
    allowableExpenditure: 0,
  },
  {
    date: "2018-06-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.57,
    allowableExpenditure: 0,
  },
  {
    date: "2018-07-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 28,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-07-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 245,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2018-07-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 3,
    unitPrice: 1200,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2018-07-31",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 27.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-08-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 10,
    unitPrice: 300,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2018-08-15",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-08-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 150,
    unitPrice: 27.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-08-25",
    symbol: "TSLA",
    type: "sell",
    quantity: 5,
    unitPrice: 310,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2018-09-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 12,
    unitPrice: 225,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2018-09-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 1.75,
    allowableExpenditure: 9.99,
  },
  {
    date: "2018-09-15",
    symbol: "GOOGL",
    type: "sell",
    quantity: 5,
    unitPrice: 1150,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2018-09-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 100,
    unitPrice: 27.6,
    allowableExpenditure: 5,
  },
  {
    date: "2018-10-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 1950,
    allowableExpenditure: 9.99,
    exchangeRate: 1.31,
  },
  {
    date: "2018-10-15",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 5.25,
    allowableExpenditure: 12.5,
  },
  {
    date: "2018-10-20",
    symbol: "AAPL",
    type: "sell",
    quantity: 5,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.31,
  },
  {
    date: "2018-11-01",
    symbol: "LLOY",
    type: "transfer",
    quantity: 5000,
    unitPrice: 0.55,
    allowableExpenditure: 0,
  },
  {
    date: "2018-11-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 12,
    unitPrice: 290,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2018-11-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 295,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2018-12-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 25,
    unitPrice: 305,
    allowableExpenditure: 11.95,
    exchangeRate: 1.28,
  },
  {
    date: "2018-12-15",
    symbol: "TSLA",
    type: "sell",
    quantity: 10,
    unitPrice: 350,
    allowableExpenditure: 11.95,
    exchangeRate: 1.27,
  },
  {
    date: "2018-12-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 10,
    unitPrice: 130,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2019-01-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.52,
    allowableExpenditure: 0,
  },
  {
    date: "2019-01-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 8,
    unitPrice: 1050,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2019-01-20",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 1.68,
    allowableExpenditure: 0,
  },
  {
    date: "2019-02-01",
    symbol: "BP",
    type: "sell",
    quantity: 1500,
    unitPrice: 5.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-02-15",
    symbol: "NVDA",
    type: "sell",
    quantity: 15,
    unitPrice: 155,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2019-02-20",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.18,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-03-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 26.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-03-02",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 5.05,
    allowableExpenditure: 12.5,
  },
  {
    date: "2019-03-15",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 1.7,
    allowableExpenditure: 0,
  },
  {
    date: "2019-03-20",
    symbol: "AMZN",
    type: "sell",
    quantity: 2,
    unitPrice: 1780,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2019-04-10",
    symbol: "NVDA",
    type: "buy",
    quantity: 40,
    unitPrice: 175,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2019-04-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 1850,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2019-04-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 150,
    unitPrice: 25.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-05-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 25,
    unitPrice: 200,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2019-05-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 6,
    unitPrice: 1150,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2019-05-20",
    symbol: "NVDA",
    type: "sell",
    quantity: 10,
    unitPrice: 160,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2019-06-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 55,
    unitPrice: 220,
    allowableExpenditure: 11.95,
    exchangeRate: 1.26,
  },
  {
    date: "2019-06-15",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.8,
    allowableExpenditure: 0,
  },
  {
    date: "2019-06-20",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 1.75,
    allowableExpenditure: 0,
  },
  {
    date: "2019-07-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 5,
    unitPrice: 1080,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2019-07-01",
    symbol: "GOOGL",
    type: "sell",
    quantity: 5,
    unitPrice: 1090,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2019-07-15",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-07-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.57,
    allowableExpenditure: 0,
  },
  {
    date: "2019-08-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 30,
    unitPrice: 240,
    allowableExpenditure: 9.99,
    exchangeRate: 1.22,
  },
  {
    date: "2019-08-10",
    symbol: "GOOGL",
    type: "sell",
    quantity: 3,
    unitPrice: 1180,
    allowableExpenditure: 9.99,
    exchangeRate: 1.23,
  },
  {
    date: "2019-08-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 25.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-08-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 8,
    unitPrice: 330,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2019-09-01",
    symbol: "BP",
    type: "buy",
    quantity: 2500,
    unitPrice: 4.95,
    allowableExpenditure: 12.5,
  },
  {
    date: "2019-09-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 26,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-09-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 10,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2019-10-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 10000,
    unitPrice: 0.58,
    allowableExpenditure: 0,
  },
  {
    date: "2019-10-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 8,
    unitPrice: 255,
    allowableExpenditure: 5,
    exchangeRate: 1.23,
  },
  {
    date: "2019-10-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 1760,
    allowableExpenditure: 12.5,
    exchangeRate: 1.24,
  },
  {
    date: "2019-11-01",
    symbol: "NVDA",
    type: "sell",
    quantity: 30,
    unitPrice: 200,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2019-11-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 15,
    unitPrice: 265,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2019-11-20",
    symbol: "BP",
    type: "sell",
    quantity: 800,
    unitPrice: 5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2019-11-25",
    symbol: "NVDA",
    type: "buy",
    quantity: 30,
    unitPrice: 210,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2019-12-01",
    symbol: "BP",
    type: "transfer",
    quantity: 2000,
    unitPrice: 4.8,
    allowableExpenditure: 0,
  },
  {
    date: "2019-12-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.6,
    allowableExpenditure: 0,
  },
  {
    date: "2019-12-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 335,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2020-01-01",
    symbol: "NVDA",
    type: "buy",
    quantity: 10,
    unitPrice: 235,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2020-01-10",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 26.2,
    allowableExpenditure: 5,
  },
  {
    date: "2020-01-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 4,
    unitPrice: 1870,
    allowableExpenditure: 9.99,
    exchangeRate: 1.31,
  },
  {
    date: "2020-01-20",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 510,
    allowableExpenditure: 9.99,
    exchangeRate: 1.31,
  },
  {
    date: "2020-02-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 315,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2020-02-15",
    symbol: "MSFT",
    type: "sell",
    quantity: 5,
    unitPrice: 340,
    allowableExpenditure: 5,
    exchangeRate: 1.31,
  },
  {
    date: "2020-02-20",
    symbol: "VOD",
    type: "sell",
    quantity: 500,
    unitPrice: 1.28,
    allowableExpenditure: 0,
  },
  {
    date: "2020-03-01",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 1.3,
    allowableExpenditure: 0,
  },
  {
    date: "2020-03-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 400,
    unitPrice: 19.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 5000,
    unitPrice: 1.1,
    allowableExpenditure: 0,
  },
  {
    date: "2020-04-15",
    symbol: "BP",
    type: "buy",
    quantity: 5000,
    unitPrice: 3.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-04-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 20000,
    unitPrice: 0.3,
    allowableExpenditure: 0,
  },
  {
    date: "2020-04-25",
    symbol: "GOOGL",
    type: "buy",
    quantity: 8,
    unitPrice: 1260,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2020-04-30",
    symbol: "TSLA",
    type: "buy",
    quantity: 3,
    unitPrice: 780,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2020-05-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 600,
    unitPrice: 15.5,
    allowableExpenditure: 11.95,
  },
  {
    date: "2020-05-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 2400,
    allowableExpenditure: 12.5,
    exchangeRate: 1.23,
  },
  {
    date: "2020-05-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.31,
    allowableExpenditure: 0,
  },
  {
    date: "2020-06-01",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 1.15,
    allowableExpenditure: 0,
  },
  {
    date: "2020-06-01",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.2,
    allowableExpenditure: 0,
  },
  {
    date: "2020-06-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 30,
    unitPrice: 350,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2020-06-15",
    symbol: "BP",
    type: "sell",
    quantity: 1500,
    unitPrice: 3.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-06-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 16,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-07-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 10,
    unitPrice: 1100,
    allowableExpenditure: 11.95,
    exchangeRate: 1.25,
  },
  {
    date: "2020-07-10",
    symbol: "AAPL",
    type: "sell",
    quantity: 10,
    unitPrice: 380,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2020-07-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 3100,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2020-07-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 310,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2020-08-01",
    symbol: "NVDA",
    type: "buy",
    quantity: 25,
    unitPrice: 430,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2020-08-10",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 3.5,
    allowableExpenditure: 12.5,
  },
  {
    date: "2020-08-15",
    symbol: "VOD",
    type: "sell",
    quantity: 1500,
    unitPrice: 1.12,
    allowableExpenditure: 0,
  },
  {
    date: "2020-09-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 430,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2020-09-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 100,
    unitPrice: 115,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2020-09-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 5,
    unitPrice: 1460,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2020-10-01",
    symbol: "AAPL",
    type: "sell",
    quantity: 50,
    unitPrice: 116,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2020-10-10",
    symbol: "MSFT",
    type: "sell",
    quantity: 5,
    unitPrice: 320,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2020-10-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 300,
    unitPrice: 17,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-10-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.28,
    allowableExpenditure: 0,
  },
  {
    date: "2020-11-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 40,
    unitPrice: 108,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2020-11-10",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 16.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2020-11-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 10000,
    unitPrice: 0.32,
    allowableExpenditure: 0,
  },
  {
    date: "2020-11-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 3100,
    allowableExpenditure: 12.5,
    exchangeRate: 1.32,
  },
  {
    date: "2020-12-01",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 1.05,
    allowableExpenditure: 0,
  },
  {
    date: "2020-12-01",
    symbol: "NVDA",
    type: "sell",
    quantity: 20,
    unitPrice: 520,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2020-12-10",
    symbol: "TSLA",
    type: "sell",
    quantity: 5,
    unitPrice: 620,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2020-12-15",
    symbol: "VOD",
    type: "transfer",
    quantity: 2000,
    unitPrice: 1.08,
    allowableExpenditure: 0,
  },
  {
    date: "2021-01-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 14.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2021-01-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 15,
    unitPrice: 335,
    allowableExpenditure: 5,
    exchangeRate: 1.35,
  },
  {
    date: "2021-01-20",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 1.08,
    allowableExpenditure: 0,
  },
  {
    date: "2021-02-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 10,
    unitPrice: 1900,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2021-02-15",
    symbol: "AMZN",
    type: "sell",
    quantity: 5,
    unitPrice: 3300,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-02-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 15.8,
    allowableExpenditure: 5,
  },
  {
    date: "2021-03-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 670,
    allowableExpenditure: 11.95,
    exchangeRate: 1.35,
  },
  {
    date: "2021-03-15",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 3.9,
    allowableExpenditure: 12.5,
  },
  {
    date: "2021-03-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 15,
    unitPrice: 510,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-04-15",
    symbol: "AAPL",
    type: "sell",
    quantity: 100,
    unitPrice: 135,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2021-04-20",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 1.25,
    allowableExpenditure: 0,
  },
  {
    date: "2021-04-25",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 700,
    allowableExpenditure: 5,
    exchangeRate: 1.34,
  },
  {
    date: "2021-05-01",
    symbol: "MSFT",
    type: "sell",
    quantity: 30,
    unitPrice: 350,
    allowableExpenditure: 11.95,
    exchangeRate: 1.35,
  },
  {
    date: "2021-05-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 24.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2021-05-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.47,
    allowableExpenditure: 0,
  },
  {
    date: "2021-06-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 600,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2021-06-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 5,
    unitPrice: 620,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2021-06-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 720,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-06-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.46,
    allowableExpenditure: 0,
  },
  {
    date: "2021-06-25",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.25,
    allowableExpenditure: 12.5,
  },
  {
    date: "2021-07-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 6,
    unitPrice: 3400,
    allowableExpenditure: 12.5,
    exchangeRate: 1.34,
  },
  {
    date: "2021-07-01",
    symbol: "AAPL",
    type: "sell",
    quantity: 30,
    unitPrice: 140,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2021-07-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 10,
    unitPrice: 2500,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2021-07-20",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.27,
    allowableExpenditure: 0,
  },
  {
    date: "2021-08-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 500,
    unitPrice: 25,
    allowableExpenditure: 9.99,
  },
  {
    date: "2021-08-15",
    symbol: "TSLA",
    type: "sell",
    quantity: 10,
    unitPrice: 680,
    allowableExpenditure: 5,
    exchangeRate: 1.35,
  },
  {
    date: "2021-08-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 2,
    unitPrice: 3250,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-09-01",
    symbol: "BP",
    type: "buy",
    quantity: 3000,
    unitPrice: 5.3,
    allowableExpenditure: 12.5,
  },
  {
    date: "2021-09-15",
    symbol: "BP",
    type: "sell",
    quantity: 2000,
    unitPrice: 5.15,
    allowableExpenditure: 9.99,
  },
  {
    date: "2021-09-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 8,
    unitPrice: 340,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-09-20",
    symbol: "GOOGL",
    type: "sell",
    quantity: 5,
    unitPrice: 2750,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-10-10",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 5,
    allowableExpenditure: 12.5,
  },
  {
    date: "2021-10-15",
    symbol: "NVDA",
    type: "sell",
    quantity: 15,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.35,
  },
  {
    date: "2021-10-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 20,
    unitPrice: 150,
    allowableExpenditure: 9.99,
    exchangeRate: 1.34,
  },
  {
    date: "2021-11-01",
    symbol: "LLOY",
    type: "sell",
    quantity: 8000,
    unitPrice: 0.48,
    allowableExpenditure: 0,
  },
  {
    date: "2021-11-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 3500,
    allowableExpenditure: 12.5,
    exchangeRate: 1.35,
  },
  {
    date: "2021-11-20",
    symbol: "MSFT",
    type: "sell",
    quantity: 5,
    unitPrice: 350,
    allowableExpenditure: 5,
    exchangeRate: 1.35,
  },
  {
    date: "2021-11-29",
    symbol: "LLOY",
    type: "buy",
    quantity: 8000,
    unitPrice: 0.46,
    allowableExpenditure: 0,
  },
  {
    date: "2021-12-01",
    symbol: "VOD",
    type: "buy",
    quantity: 10000,
    unitPrice: 1.15,
    allowableExpenditure: 0,
  },
  {
    date: "2021-12-15",
    symbol: "BP",
    type: "sell",
    quantity: 1000,
    unitPrice: 5.4,
    allowableExpenditure: 9.99,
  },
  {
    date: "2021-12-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 24.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-01-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 25,
    unitPrice: 178,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2022-01-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 12000,
    unitPrice: 0.5,
    allowableExpenditure: 0,
  },
  {
    date: "2022-01-20",
    symbol: "TSLA",
    type: "sell",
    quantity: 5,
    unitPrice: 930,
    allowableExpenditure: 11.95,
    exchangeRate: 1.33,
  },
  {
    date: "2022-02-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 50,
    unitPrice: 170,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2022-02-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 30,
    unitPrice: 171,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2022-02-15",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 1.22,
    allowableExpenditure: 0,
  },
  {
    date: "2022-02-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 10,
    unitPrice: 240,
    allowableExpenditure: 5,
    exchangeRate: 1.33,
  },
  {
    date: "2022-03-01",
    symbol: "GOOGL",
    type: "sell",
    quantity: 10,
    unitPrice: 2700,
    allowableExpenditure: 9.99,
    exchangeRate: 1.32,
  },
  {
    date: "2022-03-10",
    symbol: "AMZN",
    type: "sell",
    quantity: 3,
    unitPrice: 2900,
    allowableExpenditure: 9.99,
    exchangeRate: 1.33,
  },
  {
    date: "2022-03-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 870,
    allowableExpenditure: 11.95,
    exchangeRate: 1.33,
  },
  {
    date: "2022-03-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 4000,
    unitPrice: 0.48,
    allowableExpenditure: 0,
  },
  {
    date: "2022-04-05",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 1.2,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-04-06",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 1.18,
    allowableExpenditure: 0,
  },
  {
    date: "2022-04-10",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 26,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-04-15",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 1.15,
    allowableExpenditure: 0,
  },
  {
    date: "2022-04-20",
    symbol: "MSFT",
    type: "sell",
    quantity: 10,
    unitPrice: 270,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2022-04-25",
    symbol: "NVDA",
    type: "sell",
    quantity: 10,
    unitPrice: 190,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2022-05-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 3,
    unitPrice: 2300,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2022-05-01",
    symbol: "AMZN",
    type: "sell",
    quantity: 3,
    unitPrice: 2350,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2022-05-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 8,
    unitPrice: 2100,
    allowableExpenditure: 12.5,
    exchangeRate: 1.25,
  },
  {
    date: "2022-05-20",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.98,
    allowableExpenditure: 0,
  },
  {
    date: "2022-05-25",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.44,
    allowableExpenditure: 0,
  },
  {
    date: "2022-06-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 200,
    unitPrice: 105,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2022-06-20",
    symbol: "AMZN",
    type: "sell",
    quantity: 100,
    unitPrice: 108,
    allowableExpenditure: 9.99,
    exchangeRate: 1.23,
  },
  {
    date: "2022-06-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.42,
    allowableExpenditure: 0,
  },
  {
    date: "2022-06-25",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.9,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-07-01",
    symbol: "AAPL",
    type: "sell",
    quantity: 30,
    unitPrice: 145,
    allowableExpenditure: 9.99,
    exchangeRate: 1.2,
  },
  {
    date: "2022-07-15",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 4.8,
    allowableExpenditure: 12.5,
  },
  {
    date: "2022-07-20",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 260,
    allowableExpenditure: 9.99,
    exchangeRate: 1.2,
  },
  {
    date: "2022-07-25",
    symbol: "GOOGL",
    type: "buy",
    quantity: 100,
    unitPrice: 108,
    allowableExpenditure: 9.99,
    exchangeRate: 1.2,
  },
  {
    date: "2022-08-01",
    symbol: "GOOGL",
    type: "sell",
    quantity: 50,
    unitPrice: 115,
    allowableExpenditure: 5,
    exchangeRate: 1.21,
  },
  {
    date: "2022-08-15",
    symbol: "TSLA",
    type: "sell",
    quantity: 20,
    unitPrice: 290,
    allowableExpenditure: 5,
    exchangeRate: 1.2,
  },
  {
    date: "2022-08-20",
    symbol: "VOD",
    type: "sell",
    quantity: 800,
    unitPrice: 0.97,
    allowableExpenditure: 0,
  },
  {
    date: "2022-09-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 50,
    unitPrice: 270,
    allowableExpenditure: 9.99,
    exchangeRate: 1.22,
  },
  {
    date: "2022-09-15",
    symbol: "NVDA",
    type: "sell",
    quantity: 40,
    unitPrice: 130,
    allowableExpenditure: 9.99,
    exchangeRate: 1.2,
  },
  {
    date: "2022-09-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 250,
    allowableExpenditure: 9.99,
    exchangeRate: 1.2,
  },
  {
    date: "2022-09-25",
    symbol: "AAPL",
    type: "buy",
    quantity: 20,
    unitPrice: 150,
    allowableExpenditure: 9.99,
    exchangeRate: 1.22,
  },
  {
    date: "2022-10-01",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 120,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2022-10-05",
    symbol: "NVDA",
    type: "buy",
    quantity: 40,
    unitPrice: 125,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2022-10-15",
    symbol: "SHEL",
    type: "transfer",
    quantity: 200,
    unitPrice: 27,
    allowableExpenditure: 0,
  },
  {
    date: "2022-10-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 150,
    unitPrice: 27.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-10-25",
    symbol: "MSFT",
    type: "sell",
    quantity: 5,
    unitPrice: 248,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2022-11-01",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 5.4,
    allowableExpenditure: 9.99,
  },
  {
    date: "2022-11-15",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.95,
    allowableExpenditure: 0,
  },
  {
    date: "2022-11-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 30,
    unitPrice: 148,
    allowableExpenditure: 9.99,
    exchangeRate: 1.22,
  },
  {
    date: "2022-11-25",
    symbol: "GOOGL",
    type: "buy",
    quantity: 40,
    unitPrice: 97,
    allowableExpenditure: 9.99,
    exchangeRate: 1.21,
  },
  {
    date: "2022-12-01",
    symbol: "BP",
    type: "sell",
    quantity: 1500,
    unitPrice: 5.6,
    allowableExpenditure: 12.5,
  },
  {
    date: "2022-12-15",
    symbol: "MSFT",
    type: "buy",
    quantity: 20,
    unitPrice: 255,
    allowableExpenditure: 11.95,
    exchangeRate: 1.21,
  },
  {
    date: "2022-12-15",
    symbol: "GOOGL",
    type: "sell",
    quantity: 30,
    unitPrice: 95,
    allowableExpenditure: 5,
    exchangeRate: 1.21,
  },
  {
    date: "2022-12-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 27,
    allowableExpenditure: 5,
  },
  {
    date: "2023-01-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 20,
    unitPrice: 125,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2023-01-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 40,
    unitPrice: 140,
    allowableExpenditure: 9.99,
    exchangeRate: 1.23,
  },
  {
    date: "2023-01-15",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 0.96,
    allowableExpenditure: 0,
  },
  {
    date: "2023-01-20",
    symbol: "BP",
    type: "buy",
    quantity: 800,
    unitPrice: 5.05,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-02-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 30,
    unitPrice: 190,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2023-02-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 10000,
    unitPrice: 0.51,
    allowableExpenditure: 0,
  },
  {
    date: "2023-02-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 40,
    unitPrice: 100,
    allowableExpenditure: 9.99,
    exchangeRate: 1.23,
  },
  {
    date: "2023-02-20",
    symbol: "TSLA",
    type: "sell",
    quantity: 10,
    unitPrice: 200,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2023-03-01",
    symbol: "NVDA",
    type: "buy",
    quantity: 30,
    unitPrice: 230,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2023-03-01",
    symbol: "BP",
    type: "sell",
    quantity: 800,
    unitPrice: 5.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-03-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.49,
    allowableExpenditure: 0,
  },
  {
    date: "2023-03-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.5,
    allowableExpenditure: 0,
  },
  {
    date: "2023-04-10",
    symbol: "SHEL",
    type: "buy",
    quantity: 400,
    unitPrice: 25.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-04-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 80,
    unitPrice: 105,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2023-04-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 15,
    unitPrice: 270,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2023-04-25",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 0.9,
    allowableExpenditure: 0,
  },
  {
    date: "2023-05-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 150,
    unitPrice: 110,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2023-05-05",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.47,
    allowableExpenditure: 0,
  },
  {
    date: "2023-05-10",
    symbol: "NVDA",
    type: "sell",
    quantity: 10,
    unitPrice: 295,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2023-05-15",
    symbol: "AAPL",
    type: "sell",
    quantity: 80,
    unitPrice: 175,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2023-05-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 320,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2023-06-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 15,
    unitPrice: 210,
    allowableExpenditure: 11.95,
    exchangeRate: 1.25,
  },
  {
    date: "2023-06-10",
    symbol: "AAPL",
    type: "buy",
    quantity: 80,
    unitPrice: 180,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2023-06-15",
    symbol: "VOD",
    type: "sell",
    quantity: 3000,
    unitPrice: 1,
    allowableExpenditure: 0,
  },
  {
    date: "2023-06-15",
    symbol: "BP",
    type: "sell",
    quantity: 2000,
    unitPrice: 5.1,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-06-15",
    symbol: "MSFT",
    type: "sell",
    quantity: 10,
    unitPrice: 340,
    allowableExpenditure: 11.95,
    exchangeRate: 1.27,
  },
  {
    date: "2023-06-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 150,
    unitPrice: 26.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-06-25",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.46,
    allowableExpenditure: 0,
  },
  {
    date: "2023-07-01",
    symbol: "NVDA",
    type: "buy",
    quantity: 20,
    unitPrice: 420,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2023-07-01",
    symbol: "NVDA",
    type: "sell",
    quantity: 20,
    unitPrice: 425,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2023-07-10",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 27.8,
    allowableExpenditure: 5,
  },
  {
    date: "2023-07-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 25,
    unitPrice: 275,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2023-07-15",
    symbol: "AAPL",
    type: "sell",
    quantity: 20,
    unitPrice: 195,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2023-07-20",
    symbol: "VOD",
    type: "buy",
    quantity: 1500,
    unitPrice: 0.88,
    allowableExpenditure: 0,
  },
  {
    date: "2023-08-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 15,
    unitPrice: 330,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2023-08-10",
    symbol: "TSLA",
    type: "buy",
    quantity: 8,
    unitPrice: 260,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2023-08-15",
    symbol: "LLOY",
    type: "buy",
    quantity: 8000,
    unitPrice: 0.45,
    allowableExpenditure: 0,
  },
  {
    date: "2023-08-20",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 4.9,
    allowableExpenditure: 12.5,
  },
  {
    date: "2023-09-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 300,
    unitPrice: 27.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-09-15",
    symbol: "AMZN",
    type: "sell",
    quantity: 30,
    unitPrice: 140,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2023-09-20",
    symbol: "AAPL",
    type: "sell",
    quantity: 15,
    unitPrice: 178,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2023-10-01",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 27,
    allowableExpenditure: 11.95,
  },
  {
    date: "2023-10-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 10,
    unitPrice: 250,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2023-10-15",
    symbol: "GOOGL",
    type: "transfer",
    quantity: 50,
    unitPrice: 138,
    allowableExpenditure: 0,
    exchangeRate: 1.22,
  },
  {
    date: "2023-10-20",
    symbol: "NVDA",
    type: "sell",
    quantity: 10,
    unitPrice: 450,
    allowableExpenditure: 9.99,
    exchangeRate: 1.22,
  },
  {
    date: "2023-10-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 345,
    allowableExpenditure: 5,
    exchangeRate: 1.22,
  },
  {
    date: "2023-11-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 40,
    unitPrice: 200,
    allowableExpenditure: 11.95,
    exchangeRate: 1.22,
  },
  {
    date: "2023-11-01",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.43,
    allowableExpenditure: 0,
  },
  {
    date: "2023-11-10",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.95,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-11-15",
    symbol: "VOD",
    type: "buy",
    quantity: 4000,
    unitPrice: 0.85,
    allowableExpenditure: 0,
  },
  {
    date: "2023-11-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 27.5,
    allowableExpenditure: 5,
  },
  {
    date: "2023-12-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 30,
    unitPrice: 190,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2023-12-10",
    symbol: "GOOGL",
    type: "buy",
    quantity: 20,
    unitPrice: 132,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2023-12-15",
    symbol: "BP",
    type: "buy",
    quantity: 3000,
    unitPrice: 4.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2023-12-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 30,
    unitPrice: 135,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-01-01",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 0.82,
    allowableExpenditure: 0,
  },
  {
    date: "2024-01-05",
    symbol: "VOD",
    type: "sell",
    quantity: 800,
    unitPrice: 0.83,
    allowableExpenditure: 0,
  },
  {
    date: "2024-01-10",
    symbol: "AAPL",
    type: "buy",
    quantity: 15,
    unitPrice: 188,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-01-15",
    symbol: "MSFT",
    type: "sell",
    quantity: 20,
    unitPrice: 380,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-01-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 20,
    unitPrice: 155,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-02-01",
    symbol: "BP",
    type: "sell",
    quantity: 500,
    unitPrice: 4.85,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-02-05",
    symbol: "LLOY",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.44,
    allowableExpenditure: 0,
  },
  {
    date: "2024-02-10",
    symbol: "MSFT",
    type: "buy",
    quantity: 20,
    unitPrice: 390,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2024-02-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 25,
    unitPrice: 720,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2024-02-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 8,
    unitPrice: 395,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2024-03-01",
    symbol: "GOOGL",
    type: "buy",
    quantity: 60,
    unitPrice: 140,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2024-03-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 10,
    unitPrice: 200,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2024-03-15",
    symbol: "AMZN",
    type: "buy",
    quantity: 80,
    unitPrice: 178,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-03-20",
    symbol: "NVDA",
    type: "buy",
    quantity: 10,
    unitPrice: 880,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.8,
    allowableExpenditure: 0,
  },
  {
    date: "2024-04-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 28,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-04-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 8000,
    unitPrice: 0.48,
    allowableExpenditure: 0,
  },
  {
    date: "2024-04-25",
    symbol: "TSLA",
    type: "buy",
    quantity: 10,
    unitPrice: 168,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-05-01",
    symbol: "BP",
    type: "buy",
    quantity: 2000,
    unitPrice: 5,
    allowableExpenditure: 12.5,
  },
  {
    date: "2024-05-05",
    symbol: "GOOGL",
    type: "sell",
    quantity: 20,
    unitPrice: 155,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-05-10",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 175,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-05-15",
    symbol: "AAPL",
    type: "sell",
    quantity: 60,
    unitPrice: 185,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2024-05-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 100,
    unitPrice: 28.5,
    allowableExpenditure: 5,
  },
  {
    date: "2024-06-01",
    symbol: "NVDA",
    type: "sell",
    quantity: 30,
    unitPrice: 1200,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2024-06-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 100,
    unitPrice: 125,
    allowableExpenditure: 9.99,
    exchangeRate: 1.26,
  },
  {
    date: "2024-06-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 28.8,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-06-20",
    symbol: "AMZN",
    type: "buy",
    quantity: 30,
    unitPrice: 185,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2024-06-25",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 440,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2024-07-01",
    symbol: "NVDA",
    type: "sell",
    quantity: 50,
    unitPrice: 128,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2024-07-05",
    symbol: "AAPL",
    type: "sell",
    quantity: 25,
    unitPrice: 210,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2024-07-10",
    symbol: "BP",
    type: "buy",
    quantity: 1000,
    unitPrice: 5.15,
    allowableExpenditure: 12.5,
  },
  {
    date: "2024-07-15",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.9,
    allowableExpenditure: 0,
  },
  {
    date: "2024-07-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.5,
    allowableExpenditure: 0,
  },
  {
    date: "2024-08-01",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.85,
    allowableExpenditure: 0,
  },
  {
    date: "2024-08-10",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.88,
    allowableExpenditure: 0,
  },
  {
    date: "2024-08-15",
    symbol: "SHEL",
    type: "sell",
    quantity: 500,
    unitPrice: 29.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-08-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 5,
    unitPrice: 415,
    allowableExpenditure: 5,
    exchangeRate: 1.28,
  },
  {
    date: "2024-08-25",
    symbol: "GOOGL",
    type: "buy",
    quantity: 15,
    unitPrice: 162,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2024-09-01",
    symbol: "BP",
    type: "sell",
    quantity: 3000,
    unitPrice: 5.3,
    allowableExpenditure: 12.5,
  },
  {
    date: "2024-09-10",
    symbol: "VOD",
    type: "sell",
    quantity: 1500,
    unitPrice: 0.84,
    allowableExpenditure: 0,
  },
  {
    date: "2024-09-15",
    symbol: "GOOGL",
    type: "sell",
    quantity: 80,
    unitPrice: 158,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-09-20",
    symbol: "LLOY",
    type: "sell",
    quantity: 4000,
    unitPrice: 0.52,
    allowableExpenditure: 0,
  },
  {
    date: "2024-10-01",
    symbol: "AMZN",
    type: "buy",
    quantity: 50,
    unitPrice: 185,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2024-10-01",
    symbol: "AMZN",
    type: "sell",
    quantity: 50,
    unitPrice: 188,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2024-10-10",
    symbol: "NVDA",
    type: "buy",
    quantity: 50,
    unitPrice: 130,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2024-10-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 10,
    unitPrice: 228,
    allowableExpenditure: 9.99,
    exchangeRate: 1.25,
  },
  {
    date: "2024-10-25",
    symbol: "NVDA",
    type: "sell",
    quantity: 30,
    unitPrice: 138,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2024-10-29",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.58,
    allowableExpenditure: 0,
  },
  {
    date: "2024-10-30",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.57,
    allowableExpenditure: 0,
  },
  {
    date: "2024-11-01",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 410,
    allowableExpenditure: 9.99,
    exchangeRate: 1.3,
  },
  {
    date: "2024-11-05",
    symbol: "AMZN",
    type: "sell",
    quantity: 40,
    unitPrice: 190,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2024-11-10",
    symbol: "BP",
    type: "buy",
    quantity: 500,
    unitPrice: 5.28,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-11-15",
    symbol: "TSLA",
    type: "sell",
    quantity: 30,
    unitPrice: 350,
    allowableExpenditure: 11.95,
    exchangeRate: 1.22,
  },
  {
    date: "2024-11-20",
    symbol: "GOOGL",
    type: "buy",
    quantity: 25,
    unitPrice: 165,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2024-11-25",
    symbol: "TSLA",
    type: "sell",
    quantity: 10,
    unitPrice: 340,
    allowableExpenditure: 11.95,
    exchangeRate: 1.22,
  },
  {
    date: "2024-12-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 300,
    unitPrice: 28.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-12-10",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 0.86,
    allowableExpenditure: 0,
  },
  {
    date: "2024-12-15",
    symbol: "BP",
    type: "sell",
    quantity: 1500,
    unitPrice: 5.35,
    allowableExpenditure: 9.99,
  },
  {
    date: "2024-12-20",
    symbol: "SHEL",
    type: "buy",
    quantity: 300,
    unitPrice: 28,
    allowableExpenditure: 11.95,
  },
  {
    date: "2025-01-01",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.87,
    allowableExpenditure: 0,
  },
  {
    date: "2025-01-05",
    symbol: "GOOGL",
    type: "sell",
    quantity: 10,
    unitPrice: 160,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2025-01-10",
    symbol: "TSLA",
    type: "sell",
    quantity: 15,
    unitPrice: 360,
    allowableExpenditure: 11.95,
    exchangeRate: 1.23,
  },
  {
    date: "2025-01-15",
    symbol: "AMZN",
    type: "sell",
    quantity: 100,
    unitPrice: 195,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2025-01-20",
    symbol: "VOD",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.95,
    allowableExpenditure: 0,
  },
  {
    date: "2025-01-25",
    symbol: "SHEL",
    type: "buy",
    quantity: 150,
    unitPrice: 28.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-02-01",
    symbol: "MSFT",
    type: "sell",
    quantity: 15,
    unitPrice: 420,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2025-02-10",
    symbol: "NVDA",
    type: "sell",
    quantity: 100,
    unitPrice: 132,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2025-02-15",
    symbol: "AAPL",
    type: "buy",
    quantity: 40,
    unitPrice: 230,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2025-02-20",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.92,
    allowableExpenditure: 0,
  },
  {
    date: "2025-03-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 20,
    unitPrice: 350,
    allowableExpenditure: 5,
    exchangeRate: 1.23,
  },
  {
    date: "2025-03-05",
    symbol: "AAPL",
    type: "buy",
    quantity: 20,
    unitPrice: 220,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2025-03-10",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.54,
    allowableExpenditure: 0,
  },
  {
    date: "2025-03-15",
    symbol: "BP",
    type: "sell",
    quantity: 2000,
    unitPrice: 5.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-04-10",
    symbol: "VOD",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.9,
    allowableExpenditure: 0,
  },
  {
    date: "2025-04-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 200,
    unitPrice: 29,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-04-20",
    symbol: "BP",
    type: "buy",
    quantity: 1500,
    unitPrice: 5.2,
    allowableExpenditure: 12.5,
  },
  {
    date: "2025-04-25",
    symbol: "AMZN",
    type: "buy",
    quantity: 20,
    unitPrice: 195,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2025-04-30",
    symbol: "LLOY",
    type: "buy",
    quantity: 3000,
    unitPrice: 0.53,
    allowableExpenditure: 0,
  },
  {
    date: "2025-05-01",
    symbol: "AAPL",
    type: "buy",
    quantity: 20,
    unitPrice: 225,
    allowableExpenditure: 25,
    exchangeRate: 1.3,
  },
  {
    date: "2025-05-03",
    symbol: "BP",
    type: "sell",
    quantity: 1000,
    unitPrice: 5.4,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-05-05",
    symbol: "MSFT",
    type: "buy",
    quantity: 10,
    unitPrice: 430,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2025-05-08",
    symbol: "NVDA",
    type: "sell",
    quantity: 20,
    unitPrice: 138,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2025-05-10",
    symbol: "GOOGL",
    type: "buy",
    quantity: 50,
    unitPrice: 170,
    allowableExpenditure: 0,
    exchangeRate: 1.28,
  },
  {
    date: "2025-05-15",
    symbol: "NVDA",
    type: "sell",
    quantity: 200,
    unitPrice: 140,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2025-05-20",
    symbol: "LLOY",
    type: "buy",
    quantity: 5000,
    unitPrice: 0.52,
    allowableExpenditure: 0,
  },
  {
    date: "2025-05-25",
    symbol: "MSFT",
    type: "sell",
    quantity: 10,
    unitPrice: 440,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2025-05-25",
    symbol: "VOD",
    type: "buy",
    quantity: 1000,
    unitPrice: 0.91,
    allowableExpenditure: 0,
  },
  {
    date: "2025-06-01",
    symbol: "TSLA",
    type: "sell",
    quantity: 25,
    unitPrice: 380,
    allowableExpenditure: 11.95,
    exchangeRate: 1.25,
  },
  {
    date: "2025-06-05",
    symbol: "TSLA",
    type: "buy",
    quantity: 10,
    unitPrice: 375,
    allowableExpenditure: 5,
    exchangeRate: 1.24,
  },
  {
    date: "2025-06-10",
    symbol: "BP",
    type: "sell",
    quantity: 800,
    unitPrice: 5.38,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-06-15",
    symbol: "AAPL",
    type: "sell",
    quantity: 5,
    unitPrice: 228,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2025-06-15",
    symbol: "TSLA",
    type: "buy",
    quantity: 5,
    unitPrice: 378,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2025-06-20",
    symbol: "GOOGL",
    type: "sell",
    quantity: 30,
    unitPrice: 172,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2025-06-25",
    symbol: "NVDA",
    type: "buy",
    quantity: 30,
    unitPrice: 138,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2025-06-25",
    symbol: "AAPL",
    type: "sell",
    quantity: 10,
    unitPrice: 230,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2025-07-01",
    symbol: "GOOGL",
    type: "sell",
    quantity: 40,
    unitPrice: 175,
    allowableExpenditure: 9.99,
    exchangeRate: 1.28,
  },
  {
    date: "2025-07-05",
    symbol: "AMZN",
    type: "buy",
    quantity: 15,
    unitPrice: 197,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2025-07-10",
    symbol: "AAPL",
    type: "sell",
    quantity: 20,
    unitPrice: 232,
    allowableExpenditure: 9.99,
    exchangeRate: 1.29,
  },
  {
    date: "2025-07-15",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.95,
    allowableExpenditure: 0,
  },
  {
    date: "2025-07-15",
    symbol: "VOD",
    type: "buy",
    quantity: 2000,
    unitPrice: 0.92,
    allowableExpenditure: 0,
  },
  {
    date: "2025-07-20",
    symbol: "SHEL",
    type: "sell",
    quantity: 200,
    unitPrice: 30.5,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-07-25",
    symbol: "MSFT",
    type: "sell",
    quantity: 5,
    unitPrice: 438,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2025-08-01",
    symbol: "AMZN",
    type: "sell",
    quantity: 80,
    unitPrice: 200,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2025-08-01",
    symbol: "BP",
    type: "buy",
    quantity: 800,
    unitPrice: 5.35,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-08-05",
    symbol: "GOOGL",
    type: "buy",
    quantity: 10,
    unitPrice: 173,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2025-08-10",
    symbol: "AMZN",
    type: "sell",
    quantity: 30,
    unitPrice: 198,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
  {
    date: "2025-08-15",
    symbol: "BP",
    type: "buy",
    quantity: 500,
    unitPrice: 5.25,
    allowableExpenditure: 5,
  },
  {
    date: "2025-08-15",
    symbol: "BP",
    type: "buy",
    quantity: 700,
    unitPrice: 5.3,
    allowableExpenditure: 5,
  },
  {
    date: "2025-08-15",
    symbol: "BP",
    type: "buy",
    quantity: 300,
    unitPrice: 5.28,
    allowableExpenditure: 5,
  },
  {
    date: "2025-08-20",
    symbol: "MSFT",
    type: "buy",
    quantity: 8,
    unitPrice: 435,
    allowableExpenditure: 5,
    exchangeRate: 1.29,
  },
  {
    date: "2025-08-25",
    symbol: "LLOY",
    type: "sell",
    quantity: 3000,
    unitPrice: 0.54,
    allowableExpenditure: 0,
  },
  {
    date: "2025-09-01",
    symbol: "SHEL",
    type: "sell",
    quantity: 300,
    unitPrice: 30,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-09-05",
    symbol: "SHEL",
    type: "buy",
    quantity: 80,
    unitPrice: 29.8,
    allowableExpenditure: 5,
  },
  {
    date: "2025-09-10",
    symbol: "TSLA",
    type: "sell",
    quantity: 15,
    unitPrice: 385,
    allowableExpenditure: 11.95,
    exchangeRate: 1.24,
  },
  {
    date: "2025-09-15",
    symbol: "LLOY",
    type: "sell",
    quantity: 10000,
    unitPrice: 0.55,
    allowableExpenditure: 0,
  },
  {
    date: "2025-09-15",
    symbol: "GOOGL",
    type: "buy",
    quantity: 20,
    unitPrice: 175,
    allowableExpenditure: 9.99,
    exchangeRate: 1.27,
  },
  {
    date: "2025-09-20",
    symbol: "VOD",
    type: "sell",
    quantity: 1000,
    unitPrice: 0.93,
    allowableExpenditure: 0,
  },
  {
    date: "2025-10-01",
    symbol: "TSLA",
    type: "buy",
    quantity: 15,
    unitPrice: 370,
    allowableExpenditure: 9.99,
    exchangeRate: 1.24,
  },
  {
    date: "2025-10-05",
    symbol: "BP",
    type: "buy",
    quantity: 400,
    unitPrice: 5.32,
    allowableExpenditure: 5,
  },
  {
    date: "2025-10-10",
    symbol: "VOD",
    type: "sell",
    quantity: 2000,
    unitPrice: 0.94,
    allowableExpenditure: 0,
  },
  {
    date: "2025-10-15",
    symbol: "NVDA",
    type: "buy",
    quantity: 50,
    unitPrice: 135,
    allowableExpenditure: 5,
    exchangeRate: 1.25,
  },
  {
    date: "2025-10-15",
    symbol: "AMZN",
    type: "sell",
    quantity: 15,
    unitPrice: 199,
    allowableExpenditure: 5,
    exchangeRate: 1.27,
  },
  {
    date: "2025-10-20",
    symbol: "AAPL",
    type: "buy",
    quantity: 15,
    unitPrice: 235,
    allowableExpenditure: 5,
    exchangeRate: 1.3,
  },
  {
    date: "2025-11-01",
    symbol: "LLOY",
    type: "sell",
    quantity: 5000,
    unitPrice: 0.55,
    allowableExpenditure: 0,
  },
  {
    date: "2025-11-05",
    symbol: "BP",
    type: "buy",
    quantity: 200,
    unitPrice: 5.4,
    allowableExpenditure: 5,
  },
  {
    date: "2025-11-05",
    symbol: "BP",
    type: "sell",
    quantity: 200,
    unitPrice: 5.48,
    allowableExpenditure: 5,
  },
  {
    date: "2025-11-15",
    symbol: "SHEL",
    type: "buy",
    quantity: 100,
    unitPrice: 30,
    allowableExpenditure: 9.99,
  },
  {
    date: "2025-11-20",
    symbol: "NVDA",
    type: "sell",
    quantity: 40,
    unitPrice: 142,
    allowableExpenditure: 5,
    exchangeRate: 1.26,
  },
];

// Tax years that should have disposals in the result
const EXPECTED_ACTIVE_TAX_YEARS = [
  "2008/09",
  "2009/10",
  "2010/11",
  "2011/12",
  "2012/13",
  "2013/14",
  "2014/15",
  "2015/16",
  "2016/17",
  "2017/18",
  "2018/19",
  "2019/20",
  "2020/21",
  "2021/22",
  "2022/23",
  "2023/24",
  "2024/25",
  "2025/26",
];

// Symbols that should have remaining pool positions
const SYMBOLS_WITH_REMAINING_POSITIONS = [
  "VOD",
  "SHEL",
  "BP",
  "AAPL",
  "GOOGL",
  "AMZN",
  "MSFT",
  "TSLA",
  "NVDA",
  "LLOY",
];

function findDisposal(result: CgtResult, date: string, symbol: string) {
  for (const ty of result.taxYears) {
    const d = ty.disposals.find((disp) => disp.date === date && disp.symbol === symbol);
    if (d) return d;
  }
  return undefined;
}

function findTaxYear(result: CgtResult, taxYear: string) {
  return result.taxYears.find((ty) => ty.taxYear === taxYear);
}

describe("Mega Suite - ~500 trade comprehensive CGT test", () => {
  let result: CgtResult;

  // Run calculation once for all assertions
  it("calculates without errors", () => {
    const r = calculateCgt(trades, { splitEvents });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.errors[0].message);
    result = r.data;
    expect(result).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Structural assertions
  // -----------------------------------------------------------------------

  it("covers the expected range of tax years", () => {
    const taxYearsInResult = result.taxYears.map((ty) => ty.taxYear).sort();
    for (const ty of EXPECTED_ACTIVE_TAX_YEARS) {
      expect(taxYearsInResult).toContain(ty);
    }
  });

  it("has pools for all 10 symbols", () => {
    const poolSymbols = result.pools.map((p) => p.symbol).sort();
    for (const sym of SYMBOLS_WITH_REMAINING_POSITIONS) {
      expect(poolSymbols).toContain(sym);
    }
  });

  it("all pools have positive shares and cost", () => {
    for (const pool of result.pools) {
      expect(pool.shares).toBeGreaterThan(0);
      expect(pool.costGBP).toBeGreaterThan(0);
    }
  });

  it("produces pool snapshots for each active tax year", () => {
    const snapshotYears = Object.keys(result.poolSnapshots).sort();
    for (const ty of EXPECTED_ACTIVE_TAX_YEARS) {
      expect(snapshotYears).toContain(ty);
    }
  });

  it("split events are passed through", () => {
    expect(result.splitEvents).toHaveLength(5);
    expect(result.splitEvents.map((s) => s.symbol).sort()).toEqual([
      "AAPL",
      "AMZN",
      "GOOGL",
      "NVDA",
      "TSLA",
    ]);
  });

  it("normalised trades are sorted by date", () => {
    for (let i = 1; i < result.normalisedTrades.length; i++) {
      expect(result.normalisedTrades[i].date >= result.normalisedTrades[i - 1].date).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Same-day matching assertions
  // -----------------------------------------------------------------------

  it("applies same-day rule for VOD on 2016-05-10", () => {
    const d = findDisposal(result, "2016-05-10", "VOD");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for AAPL on 2016-12-01", () => {
    const d = findDisposal(result, "2016-12-01", "AAPL");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for MSFT on 2017-08-01", () => {
    const d = findDisposal(result, "2017-08-01", "MSFT");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for composited buys SHEL on 2016-06-01", () => {
    const d = findDisposal(result, "2016-06-01", "SHEL");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for AMZN on 2024-10-01", () => {
    const d = findDisposal(result, "2024-10-01", "AMZN");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for BP on 2025-11-05", () => {
    const d = findDisposal(result, "2025-11-05", "BP");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for TSLA on 2021-06-01", () => {
    const d = findDisposal(result, "2021-06-01", "TSLA");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for NVDA on 2023-07-01", () => {
    const d = findDisposal(result, "2023-07-01", "NVDA");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for LLOY on 2023-03-15", () => {
    const d = findDisposal(result, "2023-03-15", "LLOY");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for GOOGL on 2019-07-01", () => {
    const d = findDisposal(result, "2019-07-01", "GOOGL");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for VOD on 2020-06-01", () => {
    const d = findDisposal(result, "2020-06-01", "VOD");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  it("applies same-day rule for AMZN on 2022-05-01", () => {
    const d = findDisposal(result, "2022-05-01", "AMZN");
    expect(d).toBeDefined();
    const sameDayMatch = d!.matches.find((m) => m.rule === "same-day");
    expect(sameDayMatch).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Bed & breakfast matching assertions
  // -----------------------------------------------------------------------

  it("applies B&B for VOD sold 2016-07-01, rebought 2016-07-15 (14 days)", () => {
    const d = findDisposal(result, "2016-07-01", "VOD");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B at exactly 30 days (SHEL 2018-07-01 / 2018-07-31)", () => {
    const d = findDisposal(result, "2018-07-01", "SHEL");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
    expect(bAndBMatch!.matchedDate).toBe("2018-07-31");
  });

  it("does NOT apply B&B at day 31 (VOD 2018-08-15 / 2018-09-15)", () => {
    const d = findDisposal(result, "2018-08-15", "VOD");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find(
      (m) => m.rule === "bed-and-breakfast" && m.matchedDate === "2018-09-15"
    );
    expect(bAndBMatch).toBeUndefined();
  });

  it("does NOT apply B&B at day 31 (VOD 2025-01-20 / 2025-02-20)", () => {
    const d = findDisposal(result, "2025-01-20", "VOD");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find(
      (m) => m.rule === "bed-and-breakfast" && m.matchedDate === "2025-02-20"
    );
    expect(bAndBMatch).toBeUndefined();
  });

  it("applies B&B for NVDA sold 2022-09-15, rebought 2022-10-05 (20 days)", () => {
    const d = findDisposal(result, "2022-09-15", "NVDA");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B for LLOY sold 2017-10-01, rebought 2017-10-20 (19 days)", () => {
    const d = findDisposal(result, "2017-10-01", "LLOY");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B for AAPL sold 2023-05-15, rebought 2023-06-10 (26 days)", () => {
    const d = findDisposal(result, "2023-05-15", "AAPL");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B for BP sold 2019-02-01, rebought 2019-03-02 (29 days)", () => {
    const d = findDisposal(result, "2019-02-01", "BP");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B for LLOY sold 2021-11-01, rebought 2021-11-29 (28 days)", () => {
    const d = findDisposal(result, "2021-11-01", "LLOY");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  it("applies B&B for SHEL at exactly 30 days (2023-09-01 / 2023-10-01)", () => {
    const d = findDisposal(result, "2023-09-01", "SHEL");
    expect(d).toBeDefined();
    const bAndBMatch = d!.matches.find((m) => m.rule === "bed-and-breakfast");
    expect(bAndBMatch).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Transfer assertions
  // -----------------------------------------------------------------------

  it("processes LLOY transfer as no-gain/no-loss (2018-11-01)", () => {
    const d = findDisposal(result, "2018-11-01", "LLOY");
    expect(d).toBeDefined();
    expect(d!.type).toBe("transfer");
    expect(d!.gainGBP).toBeCloseTo(0, 2);
  });

  it("processes BP transfer to spouse (2019-12-01)", () => {
    const d = findDisposal(result, "2019-12-01", "BP");
    expect(d).toBeDefined();
    expect(d!.type).toBe("transfer");
    expect(d!.gainGBP).toBeCloseTo(0, 2);
  });

  it("processes VOD transfer to spouse (2020-12-15)", () => {
    const d = findDisposal(result, "2020-12-15", "VOD");
    expect(d).toBeDefined();
    expect(d!.type).toBe("transfer");
    expect(d!.gainGBP).toBeCloseTo(0, 2);
  });

  it("processes SHEL transfer to spouse (2022-10-15)", () => {
    const d = findDisposal(result, "2022-10-15", "SHEL");
    expect(d).toBeDefined();
    expect(d!.type).toBe("transfer");
    expect(d!.gainGBP).toBeCloseTo(0, 2);
  });

  it("processes GOOGL transfer to spouse (2023-10-15)", () => {
    const d = findDisposal(result, "2023-10-15", "GOOGL");
    expect(d).toBeDefined();
    expect(d!.type).toBe("transfer");
    expect(d!.gainGBP).toBeCloseTo(0, 2);
  });

  // -----------------------------------------------------------------------
  // Tax year boundary assertions
  // -----------------------------------------------------------------------

  it("places April 5 buy in 2015/16 tax year", () => {
    const ty201516 = findTaxYear(result, "2015/16");
    expect(ty201516).toBeDefined();
    const acq = ty201516!.acquisitions.find((a) => a.date === "2016-04-05" && a.symbol === "BP");
    expect(acq).toBeDefined();
  });

  it("places April 6 buy in 2016/17 tax year", () => {
    const ty201617 = findTaxYear(result, "2016/17");
    expect(ty201617).toBeDefined();
    const acq = ty201617!.acquisitions.find((a) => a.date === "2016-04-06" && a.symbol === "BP");
    expect(acq).toBeDefined();
  });

  it("places April 5 sell in the ending tax year (VOD 2022-04-05 in 2021/22)", () => {
    const ty202122 = findTaxYear(result, "2021/22");
    expect(ty202122).toBeDefined();
    const d = ty202122!.disposals.find(
      (disp) => disp.date === "2022-04-05" && disp.symbol === "VOD"
    );
    expect(d).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 2024/25 split rate period assertions
  // -----------------------------------------------------------------------

  it("2024/25 has two rate periods", () => {
    const ty202425 = findTaxYear(result, "2024/25");
    expect(ty202425).toBeDefined();
    expect(ty202425!.periods).toHaveLength(2);
    expect(ty202425!.periods[0].rates).toEqual({ basic: 10, higher: 20 });
    expect(ty202425!.periods[1].rates).toEqual({ basic: 18, higher: 24 });
  });

  it("LLOY sell on 2024-10-29 is in the old-rate period", () => {
    const ty202425 = findTaxYear(result, "2024/25");
    expect(ty202425).toBeDefined();
    const oldPeriod = ty202425!.periods[0];
    const d = oldPeriod.disposals.find(
      (disp) => disp.date === "2024-10-29" && disp.symbol === "LLOY"
    );
    expect(d).toBeDefined();
  });

  it("LLOY sell on 2024-10-30 is in the new-rate period", () => {
    const ty202425 = findTaxYear(result, "2024/25");
    expect(ty202425).toBeDefined();
    const newPeriod = ty202425!.periods[1];
    const d = newPeriod.disposals.find(
      (disp) => disp.date === "2024-10-30" && disp.symbol === "LLOY"
    );
    expect(d).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Stock split assertions
  // -----------------------------------------------------------------------

  it("AAPL post-split trades have adjustment factor of 1", () => {
    const postSplitDisposals = result.taxYears.flatMap((ty) =>
      ty.disposals.filter((d) => d.symbol === "AAPL" && d.date > "2020-08-31")
    );
    for (const d of postSplitDisposals) {
      expect(d.adjustmentFactor).toBe(1);
    }
  });

  it("NVDA post-split trades have adjustment factor of 1", () => {
    const postSplitDisposals = result.taxYears.flatMap((ty) =>
      ty.disposals.filter((d) => d.symbol === "NVDA" && d.date > "2024-06-10")
    );
    for (const d of postSplitDisposals) {
      expect(d.adjustmentFactor).toBe(1);
    }
  });

  // -----------------------------------------------------------------------
  // Full disposal scenario
  // -----------------------------------------------------------------------

  it("handles full TSLA disposal on 2019-06-01", () => {
    const d = findDisposal(result, "2019-06-01", "TSLA");
    expect(d).toBeDefined();
    expect(d!.type).toBe("disposal");
  });

  // -----------------------------------------------------------------------
  // Multiple sells on same day different symbols
  // -----------------------------------------------------------------------

  it("handles multiple sells on 2023-06-15 (VOD, BP, MSFT)", () => {
    const vodSell = findDisposal(result, "2023-06-15", "VOD");
    const bpSell = findDisposal(result, "2023-06-15", "BP");
    const msftSell = findDisposal(result, "2023-06-15", "MSFT");
    expect(vodSell).toBeDefined();
    expect(bpSell).toBeDefined();
    expect(msftSell).toBeDefined();
  });

  it("handles multiple sells on 2017-07-15 (VOD, LLOY)", () => {
    const vodSell = findDisposal(result, "2017-07-15", "VOD");
    const lloySell = findDisposal(result, "2017-07-15", "LLOY");
    expect(vodSell).toBeDefined();
    expect(lloySell).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Disposal structural invariants
  // -----------------------------------------------------------------------

  it("has a reasonable number of disposals across all years", () => {
    const totalDisposals = result.taxYears.reduce((sum, ty) => sum + ty.disposals.length, 0);
    expect(totalDisposals).toBeGreaterThan(100);
  });

  it("every disposal has at least one match", () => {
    for (const ty of result.taxYears) {
      for (const d of ty.disposals) {
        expect(d.matches.length).toBeGreaterThan(0);
      }
    }
  });

  it("every disposal match has a valid rule", () => {
    const validRules = new Set(["same-day", "bed-and-breakfast", "section-104"]);
    for (const ty of result.taxYears) {
      for (const d of ty.disposals) {
        for (const m of d.matches) {
          expect(validRules.has(m.rule)).toBe(true);
        }
      }
    }
  });

  it("every disposal has pool state snapshots", () => {
    for (const ty of result.taxYears) {
      for (const d of ty.disposals) {
        expect(Array.isArray(d.poolStateBefore)).toBe(true);
        expect(Array.isArray(d.poolStateAfter)).toBe(true);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Pinned regression values — catches subtle matching bugs
  // -----------------------------------------------------------------------

  it("matching rule counts match pinned values", () => {
    let sameDayCount = 0;
    let bAndBCount = 0;
    let poolCount = 0;
    for (const ty of result.taxYears) {
      for (const d of ty.disposals) {
        for (const m of d.matches) {
          if (m.rule === "same-day") sameDayCount++;
          if (m.rule === "bed-and-breakfast") bAndBCount++;
          if (m.rule === "section-104") poolCount++;
        }
      }
    }
    expect(sameDayCount).toBe(15);
    expect(bAndBCount).toBe(34);
    expect(poolCount).toBe(172);
  });

  it("final pool state matches pinned values", () => {
    const pool = (sym: string) => result.pools.find((p) => p.symbol === sym)!;
    expect(pool("VOD").shares).toBeCloseTo(48100, 0);
    expect(pool("BP").shares).toBeCloseTo(31600, 0);
    expect(pool("SHEL").shares).toBeCloseTo(2730, 0);
    expect(pool("LLOY").shares).toBeCloseTo(89000, 0);
    expect(pool("NVDA").shares).toBeCloseTo(3140, 0);
    expect(pool("AMZN").shares).toBeCloseTo(1340, 0);
    expect(pool("MSFT").shares).toBeCloseTo(170, 0);
    expect(pool("AAPL").shares).toBeCloseTo(772, 0);
    expect(pool("TSLA").shares).toBeCloseTo(282, 0);
    expect(pool("GOOGL").shares).toBeCloseTo(1660, 0);
    expect(pool("VOD").costGBP).toBeCloseTo(58155.29, 0);
    expect(pool("AAPL").costGBP).toBeCloseTo(67418.91, 0);
    expect(pool("NVDA").costGBP).toBeCloseTo(74727.91, 0);
  });

  it("AEA is correctly set per tax year", () => {
    const expectedAEAs: Record<string, number> = {
      "2008/09": 9600,
      "2009/10": 10100,
      "2010/11": 10100,
      "2011/12": 10600,
      "2012/13": 10600,
      "2013/14": 10900,
      "2014/15": 11000,
      "2015/16": 11100,
      "2016/17": 11100,
      "2017/18": 11300,
      "2018/19": 11700,
      "2019/20": 12000,
      "2020/21": 12300,
      "2021/22": 12300,
      "2022/23": 12300,
      "2023/24": 6000,
      "2024/25": 3000,
      "2025/26": 3000,
    };
    for (const ty of result.taxYears) {
      if (expectedAEAs[ty.taxYear] !== undefined) {
        expect(ty.annualExemptAmount).toBe(expectedAEAs[ty.taxYear]);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Summary printout for manual comparison
  // -----------------------------------------------------------------------

  it("prints summary for manual review", () => {
    const lines: string[] = [];
    lines.push("\n========== MEGA SUITE CGT SUMMARY ==========\n");

    for (const ty of result.taxYears) {
      lines.push(`Tax Year: ${ty.taxYear}`);
      lines.push(`  AEA: ${ty.annualExemptAmount}`);
      lines.push(`  Disposals: ${ty.disposalCount}`);
      lines.push(`  Total proceeds: ${ty.totalProceeds.toFixed(2)}`);
      lines.push(`  Total costs: ${ty.totalCosts.toFixed(2)}`);
      lines.push(`  Total gains: ${ty.totalGains.toFixed(2)}`);
      lines.push(`  Total losses: ${ty.totalLosses.toFixed(2)}`);
      lines.push(`  Net gain/loss: ${ty.netGainLoss.toFixed(2)}`);
      lines.push(`  Taxable gain: ${ty.taxableGain.toFixed(2)}`);
      lines.push(`  Tax (basic): ${ty.taxBasicRate.toFixed(2)}`);
      lines.push(`  Tax (higher): ${ty.taxHigherRate.toFixed(2)}`);
      if (ty.periods.length > 1) {
        for (const p of ty.periods) {
          lines.push(
            `  Period ${p.from} to ${p.to}: rates ${p.rates.basic}%/${p.rates.higher}%, disposals: ${p.disposalCount}, taxable: ${p.taxableGain.toFixed(2)}`
          );
        }
      }
      lines.push("");
    }

    lines.push("Final pool state:");
    for (const pool of result.pools) {
      lines.push(
        `  ${pool.symbol}: ${pool.shares.toFixed(2)} shares, cost ${pool.costGBP.toFixed(2)} GBP, avg ${(pool.costGBP / pool.shares).toFixed(4)}/share`
      );
    }
    lines.push("");

    let sameDayCount = 0;
    let bAndBCount = 0;
    let poolCount = 0;
    for (const ty of result.taxYears) {
      for (const d of ty.disposals) {
        for (const m of d.matches) {
          if (m.rule === "same-day") sameDayCount++;
          if (m.rule === "bed-and-breakfast") bAndBCount++;
          if (m.rule === "section-104") poolCount++;
        }
      }
    }
    lines.push(
      `Matching rule usage: same-day=${sameDayCount}, B&B=${bAndBCount}, section-104=${poolCount}`
    );
    lines.push("==============================================\n");

    // Print to console for manual review when running with --reporter=verbose
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
