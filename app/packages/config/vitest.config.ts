import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globalSetup: ["../../test-support/temp-sweep.ts"], setupFiles: ["../../test-support/temp-root.ts"], include: ["test/**/*.test.ts"], environment: "node" },
});
