// `pnpm tsx eval/per-client/gen-transcripts.ts`: rewrites fixtures/transcripts/ from scenario.ts. A test fails when they differ.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { transcriptFiles } from "./scenario.ts";

const dir = path.join(import.meta.dirname, "fixtures", "transcripts");
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(transcriptFiles())) writeFileSync(path.join(dir, name), text);
console.log("written", Object.keys(transcriptFiles()).length);
