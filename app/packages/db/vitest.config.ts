import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["../../test-support/hermetic-home.ts"] },
});
