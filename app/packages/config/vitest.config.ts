import { hubVitest } from "./src/vitest";

export default hubVitest({ include: ["test/**/*.test.ts"], environment: "node" });
