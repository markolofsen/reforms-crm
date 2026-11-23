import { hubVitest } from "@hub/config/vitest";

// The global fetch throws (decision 0039 point 7), so a test that forgot to inject a transport fails loudly instead of
// reaching OpenRouter.
export default hubVitest({ include: ["test/**/*.test.ts"], environment: "node", hermetic: true, setupFiles: ["./test/no-network.ts"] });
