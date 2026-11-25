import { hubVitest } from "@hub/config/vitest";

// P144: the watcher never reaches Telegram or a model in a test: the reader and the transport are fakes.
export default hubVitest({ include: ["test/**/*.test.ts"], environment: "node", hermetic: true });
