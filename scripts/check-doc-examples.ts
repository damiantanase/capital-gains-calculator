/**
 * Type-checks the fenced ```typescript code blocks in README.md and docs/EXAMPLES.md
 * against the library's own source, so documentation cannot drift from the API.
 *
 * For each block we:
 *   1. rewrite `from "capital-gains-calculator"` to a relative import of ../src
 *   2. wrap the body in an async function (snippets use top-level await/return)
 *   3. emit all blocks into a temp dir and run `tsc --noEmit` over them
 *
 * A minimal ambient declaration supplies `console`/`process` so the snippets do
 * not require @types/node (the library itself is browser-safe, zero-dep).
 *
 * Usage: npx tsx scripts/check-doc-examples.ts
 * Exits non-zero if any block fails to type-check.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const srcIndex = join(projectRoot, "src", "index.ts");
const outDir = join(projectRoot, "node_modules", ".doc-examples");

const DOC_FILES = ["README.md", "docs/EXAMPLES.md"];

interface Block {
  source: string;
  index: number;
  code: string;
}

function extractBlocks(markdown: string): { source: string; index: number; code: string }[] {
  const blocks: { source: string; index: number; code: string }[] = [];
  const re = /```(?:typescript|ts)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(markdown)) !== null) {
    blocks.push({ source: "", index: i++, code: m[1] });
  }
  return blocks;
}

function importPathFor(file: string): string {
  // Relative path from the temp dir to src/index.ts, without extension.
  const rel = relative(outDir, srcIndex).replace(/\\/g, "/").replace(/\.ts$/, "");
  return rel.startsWith(".") ? rel : "./" + rel;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const allBlocks: Block[] = [];
for (const file of DOC_FILES) {
  const md = readFileSync(join(projectRoot, file), "utf-8");
  for (const b of extractBlocks(md)) {
    allBlocks.push({ source: file, index: b.index, code: b.code });
  }
}

const importPath = importPathFor("");

// Ambient globals so snippets using console/process type-check without @types/node.
writeFileSync(
  join(outDir, "globals.d.ts"),
  [
    "declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };",
    "declare const process: { exit(code?: number): never };",
    "",
  ].join("\n")
);

// Blocks that only declare illustrative types (no import, no executable code)
// are reference material, not runnable snippets — checking them would clash with
// the library's real type names. Skip a block when, after stripping comments and
// type/interface declarations, nothing executable remains.
function isTypeReferenceBlock(code: string): boolean {
  if (/^\s*import\s/m.test(code)) return false;
  const stripped = code
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // remove whole interface/type/class declaration bodies
    .replace(/\b(export\s+)?(interface|class)\s+\w+[\s\S]*?\n\}/g, "")
    .replace(/\b(export\s+)?type\s+\w+[\s\S]*?;/g, "")
    .trim();
  return stripped.length === 0;
}

const emitted: string[] = [];
const skipped: string[] = [];
for (const b of allBlocks) {
  if (isTypeReferenceBlock(b.code)) {
    skipped.push(`${b.source}#${b.index}`);
    continue;
  }
  // Rewrite the published-package import to the local source.
  const code = b.code.replace(/from\s+["']capital-gains-calculator["']/g, `from "${importPath}"`);

  // Snippets are written as top-level scripts (top-level await, early return,
  // process.exit). Hoist the import lines to module scope and wrap the rest in
  // an async function so top-level await/return are legal.
  const lines = code.split("\n");
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (/^\s*import\s/.test(line)) importLines.push(line);
    else bodyLines.push(line);
  }

  const fileName = `${b.source.replace(/\W/g, "_")}_block_${b.index}.ts`;
  const wrapped = [
    importLines.join("\n"),
    `export async function __block_${b.index}__(): Promise<void> {`,
    bodyLines.join("\n"),
    `}`,
    "",
  ].join("\n");
  writeFileSync(join(outDir, fileName), wrapped);
  emitted.push(fileName);
}

writeFileSync(
  join(outDir, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        // Snippets routinely declare illustrative vars they don't all use.
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
      include: ["*.ts"],
    },
    null,
    2
  )
);

console.log(
  `Checking ${emitted.length} documentation code blocks from ${DOC_FILES.join(", ")}` +
    (skipped.length ? ` (skipped ${skipped.length} type-reference block(s))` : "") +
    "..."
);

try {
  execFileSync("npx", ["tsc", "--noEmit", "-p", join(outDir, "tsconfig.json")], {
    cwd: projectRoot,
    stdio: "pipe",
    encoding: "utf-8",
  });
  console.log(`All ${emitted.length} documentation code blocks type-check.`);
  rmSync(outDir, { recursive: true, force: true });
} catch (err: unknown) {
  const e = err as { stdout?: string; stderr?: string };
  console.error("Documentation code blocks failed to type-check:\n");
  // Map temp filenames back to their doc source for a readable report.
  const raw = (e.stdout || "") + (e.stderr || "");
  console.error(raw);
  console.error("\nTemp files retained for inspection at: " + relative(projectRoot, outDir));
  process.exit(1);
}
