/**
 * Generates external-tool-compatible fixture files from the mega test suite.
 *
 * Produces two files in tests/fixtures/:
 *   - mega-suite-with-splits.txt    — All B/S trades + restructuring events (no transfers)
 *   - mega-suite-with-transfers.txt — All B/S/T trades + transfers (no restructuring events)
 *
 * The external tool (cgtcalculator.com) does not support both restructuring AND
 * transfers for the same stock, so these are split into separate files for comparison.
 *
 * Usage: npx tsx scripts/generate-fixtures.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const testFile = join(projectRoot, "tests", "mega-suite.test.ts");
const fixturesDir = join(projectRoot, "generated");

mkdirSync(fixturesDir, { recursive: true });

const content = readFileSync(testFile, "utf-8");
const tradesMatch = content.match(/const trades: CgtTradeInput\[\] = \[([\s\S]*?)\n\];/);
if (!tradesMatch) {
  console.error("Could not find trades array in mega-suite.test.ts");
  process.exit(1);
}

const tradesBlock = tradesMatch[1];
const tradeLines = tradesBlock.split("\n").filter((l) => l.trim().startsWith("{"));

interface ParsedTrade {
  date: string;
  symbol: string;
  type: string;
  quantity: number;
  unitPrice: number;
  fees: number;
  exchangeRate: number;
}

const trades: ParsedTrade[] = tradeLines.map((line) => {
  const m = (r: RegExp) => line.match(r)?.[1];
  return {
    date: m(/date: "([^"]+)"/)!,
    symbol: m(/symbol: "([^"]+)"/)!,
    type: m(/type: "([^"]+)"/)!,
    quantity: parseFloat(m(/quantity: ([\d.]+)/) || "0"),
    unitPrice: parseFloat(m(/unitPrice: ([\d.]+)/) || "0"),
    fees: parseFloat(m(/allowableExpenditure: ([\d.]+)/) || "0"),
    exchangeRate: m(/exchangeRate: ([\d.]+)/) ? parseFloat(m(/exchangeRate: ([\d.]+)/)!) : 1,
  };
});

const splits = [
  { date: "31/08/2020", symbol: "AAPL", factor: 4 },
  { date: "06/06/2022", symbol: "AMZN", factor: 20 },
  { date: "18/07/2022", symbol: "GOOGL", factor: 20 },
  { date: "25/08/2022", symbol: "TSLA", factor: 3 },
  { date: "10/06/2024", symbol: "NVDA", factor: 10 },
];

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function formatPrice(priceGBP: number): string {
  if (priceGBP < 1) return priceGBP.toFixed(4);
  if (priceGBP < 10) return priceGBP.toFixed(3);
  return priceGBP.toFixed(2);
}

function tradeToLine(t: ParsedTrade, includeTransfersAsT: boolean): string {
  const dateStr = formatDate(t.date);
  const priceGBP = t.unitPrice / t.exchangeRate;
  const priceStr = formatPrice(priceGBP);

  if (t.type === "transfer") {
    if (includeTransfersAsT) {
      return `T\t${dateStr}\t${t.symbol}\t${t.quantity}\t${priceStr}\t${t.fees}\t0`;
    } else {
      // In the splits file, omit transfers entirely (they'll be in the other file)
      return "";
    }
  }

  const bs = t.type === "buy" ? "B" : "S";
  return `${bs}\t${dateStr}\t${t.symbol}\t${t.quantity}\t${priceStr}\t${t.fees}\t0`;
}

// File 1: With splits (no transfers)
const splitsFileLines: string[] = [];
for (const s of splits) {
  splitsFileLines.push(`R\t${s.date}\t${s.symbol}\t${s.factor}`);
}
for (const t of trades) {
  if (t.type === "transfer") continue;
  splitsFileLines.push(tradeToLine(t, false));
}

// File 2: With transfers (no splits)
const transfersFileLines: string[] = [];
for (const t of trades) {
  const line = tradeToLine(t, true);
  if (line) transfersFileLines.push(line);
}

const splitsFilePath = join(fixturesDir, "mega-suite-with-splits.txt");
const transfersFilePath = join(fixturesDir, "mega-suite-with-transfers.txt");

writeFileSync(splitsFilePath, splitsFileLines.join("\n") + "\n");
writeFileSync(transfersFilePath, transfersFileLines.join("\n") + "\n");

console.log(`Generated:`);
console.log(`  ${splitsFilePath} (${splitsFileLines.length} lines: ${splits.length} restructurings + ${splitsFileLines.length - splits.length} trades)`);
console.log(`  ${transfersFilePath} (${transfersFileLines.length} lines: ${trades.filter((t) => t.type === "transfer").length} transfers + ${transfersFileLines.length - trades.filter((t) => t.type === "transfer").length} trades)`);
