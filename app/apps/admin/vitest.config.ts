import { defineConfig } from "vitest/config";

// One alias source: the `paths` of tsconfig.json (`@/*`).
export default defineConfig({ resolve: { tsconfigPaths: true }, test: { include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"] } });
