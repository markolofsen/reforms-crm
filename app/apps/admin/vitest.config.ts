import { defineConfig } from "vitest/config";

// One alias source: the `paths` of tsconfig.json (`@/*`).
export default defineConfig({ resolve: { tsconfigPaths: true }, test: { globalSetup: ["../../test-support/temp-sweep.ts"], setupFiles: ["../../test-support/temp-root.ts"], include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"] } });
