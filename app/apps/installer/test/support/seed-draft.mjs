#!/usr/bin/env node
// Test only (e2e seeding): `node seed-draft.mjs --project <slug>`, JSON on stdin, one JSON line out. Records a draft row the
// way `draft_write` records one after Mail saved it (P129 A3: `hub record-draft` is gone; the agent records through the
// tool). For flows that need a draft row without Mail. Never on an agent's path: no skill or rule names it.
import { register } from "tsx/esm/api";

register();
const { seedDraft } = await import("./seed-draft-impl.ts");
const i = process.argv.indexOf("--project");
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const out = await seedDraft(process.argv[i + 1] ?? "", Buffer.concat(chunks).toString("utf8"));
console.log(JSON.stringify(out));
process.exitCode = out.ok ? 0 : 2;
