import { hubVitest } from "@hub/config/vitest";

// One alias source: the `paths` of tsconfig.json (`@/*`).
export default hubVitest({ tsconfigPaths: true, include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"] });
