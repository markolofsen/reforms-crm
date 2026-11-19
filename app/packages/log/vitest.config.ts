import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node", setupFiles: ["../../test-support/hermetic-home.ts"] },
});
