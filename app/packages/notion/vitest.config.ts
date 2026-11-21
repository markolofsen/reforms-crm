import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node", globalSetup: ["../../test-support/temp-sweep.ts"], setupFiles: ["../../test-support/temp-root.ts", "../../test-support/hermetic-home.ts"] },
});
