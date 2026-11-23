import { hubVitest } from "@hub/config/vitest";

export default hubVitest({ include: ["test/**/*.test.ts", "eval/**/*.test.ts"], testTimeout: 90000 });
