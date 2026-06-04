import { defineConfig } from "vitest/config";

// Stryker-only Vitest config.
//
// Stryker's vitest-runner manages coverage itself (per-test) and disables Vitest's
// own coverage reporting, so the 100% thresholds in the base vitest.config.ts would
// either be ignored or — in the worst case — trip Stryker's dry run. This config
// drops the coverage block entirely while keeping the test discovery identical, so
// mutation runs never enforce the publish-time coverage gate. The real
// vitest.config.ts is untouched, so `npm test` / `npm run build` keep enforcing 100%.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
