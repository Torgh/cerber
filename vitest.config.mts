import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./"),
      "server-only": root("./test/server-only.ts"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "mcp/**/*.test.ts"],
    // The first date formatting loads ICU data, and the MCP test starts a server: slow on a cold CI runner.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts", "proxy.ts"],
      exclude: ["**/*.test.ts", "lib/testUtils.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      // A little below today's numbers: CI fails when a change drops coverage noticeably.
      thresholds: { statements: 92, branches: 83, functions: 93, lines: 95 },
    },
  },
});
