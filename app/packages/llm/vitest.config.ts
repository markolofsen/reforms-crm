import { defineConfig } from "vitest/config";

// Two setups: every test file gets its own empty instance home, and the global fetch throws (decision 0039 point 7), so a test
// that forgot to inject a transport fails loudly instead of reaching OpenRouter.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node", setupFiles: ["../../test-support/hermetic-home.ts", "./test/no-network.ts"] },
});
