// P120 W1: writes `packages/api/openapi.json`, the one input of Orval, from the server's declared operations and their
// `@hub/contract` schemas, over the hand-kept `openapi.base.json` that W2 deletes. `pnpm --filter @hub/api generate` runs it first.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emittedDocument } from "../src/http/emitted";

const api = (f: string) => fileURLToPath(new URL(`../../../packages/api/${f}`, import.meta.url));
writeFileSync(api("openapi.json"), `${JSON.stringify(emittedDocument(JSON.parse(readFileSync(api("openapi.base.json"), "utf8"))), null, 2)}\n`);
