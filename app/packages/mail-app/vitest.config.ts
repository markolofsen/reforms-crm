import { hubVitest } from "@hub/config/vitest";

export default hubVitest({ include: ["test/**/*.test.ts"], environment: "node", hermetic: true });
