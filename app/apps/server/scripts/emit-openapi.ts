// P120: writes `packages/api/openapi.json`, the one input of Orval, from the server's declared operations and their
// `@hub/contract` schemas. `pnpm --filter @hub/api generate` runs it first.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emittedDocument } from "../src/http/emitted";

writeFileSync(fileURLToPath(new URL("../../../packages/api/openapi.json", import.meta.url)), `${JSON.stringify(emittedDocument(), null, 2)}\n`);
