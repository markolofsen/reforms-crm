import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";

// Gate (P137 verdict 3, L2): the critical places of the Hub each leave one ops line at their outcome (info on success with its
// time, warn on a refusal with its code, error once with the cause). A place is a file and the line it must keep; a refactor that
// drops the line fails here, and the fix is the line back (or this list moved with the code, in the same change). The check reads
// source text only. `@docs/core/28-ops-log.md` ("What is logged where") is the same list in words.
const APP = path.join(CORE_ROOT, "app");

interface Place { place: string; file: string; line: RegExp }

const CRITICAL_PLACES: readonly Place[] = [
  { place: "send check (dry run)", file: "apps/server/src/send/sends-routes.ts", line: /"send check: ready"/ },
  { place: "send applied", file: "apps/server/src/send/sends-routes.ts", line: /log\.info\("send applied"/ },
  { place: "send refused", file: "apps/server/src/send/sends-routes.ts", line: /log\.warn\("a confirmed send was refused"/ },
  { place: "mail send failed", file: "apps/server/src/send/sends-routes.ts", line: /log\.error\("a mail send failed/ },
  { place: "agent send on the owner's word", file: "apps/server/src/send/sends-routes.ts", line: /log\.info\("agent send on the owner's word applied"/ },
  { place: "batch item outcome", file: "apps/server/src/send/batch-door.ts", line: /"batch item sent"/ },
  { place: "batch run end", file: "apps/server/src/send/batch-door.ts", line: /`batch run \$\{run\.state\}`/ },
  { place: "messenger send failed", file: "packages/messengers/src/door.ts", line: /ops\("send"\)\.error\("a messenger send failed/ },
  { place: "Mail draft saved", file: "packages/mail-app/src/writer/writer.ts", line: /"Mail reply draft saved"/ },
  { place: "Mail draft refused", file: "packages/mail-app/src/writer/protocol.ts", line: /ops\("mail"\)\.error\("Mail refused a draft write"/ },
  { place: "Mail script failed", file: "packages/mail-app/src/writer/writer.ts", line: /ops\("mail"\)\.error\("a Mail script failed"/ },
  { place: "agent tool that writes (draft, messenger draft, pointer, send)", file: "packages/agent/src/mcp/define.ts", line: /ops\("agent"\)\.info\(`tool \$\{t\.name\} done`/ },
  { place: "agent tool refused", file: "packages/agent/src/mcp/define.ts", line: /ops\("agent"\)\.warn\(`tool \$\{t\.name\} refused`/ },
  { place: "Notion call failed", file: "packages/notion/src/notion.ts", line: /ops\("notion"\)\.error\(`Notion \$\{op\} failed`/ },
  { place: "Notion retry (rate limit)", file: "packages/notion/src/sdk-log.ts", line: /ops\("notion"\)\.warn\("Notion asked to wait/ },
  { place: "Notion client card created", file: "packages/notion/src/chat-client.ts", line: /"client card created in Notion from a chat"/ },
  { place: "Notion client map", file: "packages/notion/src/client-map.ts", line: /log\.info\(`client map copied to Notion/ },
  { place: "Notion send stamp", file: "packages/notion/src/stamp.ts", line: /log\.info\("send stamped in Notion/ },
  { place: "Mail reader pass failed", file: "apps/server/src/mail/inbound.ts", line: /ops\("mail"\)\.error\("a pass of the Mail reader failed"/ },
  { place: "Mail mailbox read failed", file: "apps/server/src/mail/inbound.ts", line: /ops\("mail"\)\.warn\("reading a mailbox for the Mail reader failed"/ },
  { place: "messenger connected", file: "packages/messengers/src/poller.ts", line: /\.info\("receiver connected"/ },
  { place: "messenger reconnected", file: "packages/messengers/src/poller.ts", line: /\.info\("receiver reconnected"/ },
  { place: "messenger dropped", file: "packages/messengers/src/poller.ts", line: /log\.warn\(kind === "flood_wait"/ },
  { place: "messenger stopped", file: "packages/messengers/src/poller.ts", line: /"the receiver stopped"/ },
  { place: "agent session started", file: "apps/server/src/terminal/terminal.ts", line: /ops\("agent"\)\.info\("agent session started"/ },
  { place: "agent session stopped", file: "apps/server/src/terminal/terminal.ts", line: /ops\("agent"\)\.info\("agent session stopped"/ },
  { place: "migrations applied", file: "packages/db/src/client.ts", line: /ops\("db"\)\.info\("database migrations applied"/ },
  { place: "migration failed", file: "packages/db/src/client.ts", line: /ops\("db"\)\.error\("a database migration failed"/ },
  { place: "backup", file: "apps/installer/src/commands/backup/snapshot.ts", line: /log\.info\("backup snapshot made"/ },
  { place: "installer and doctor runs", file: "apps/installer/src/runner.ts", line: /runLine\("doctor"/ },
  { place: "slow request and 5xx", file: "apps/server/src/http/request-action.ts", line: /ops\("server"\)\.warn\(`slow request/ },
  { place: "server 500", file: "apps/server/src/app.ts", line: /ops\("server"\)\.error\(`500 / },
  { place: "log retention", file: "packages/log/src/retention.ts", line: /ops\("server"\)\.info\("logs: retention/ },
];

describe("every critical place keeps its ops line (P137 L2)", () => {
  it.each(CRITICAL_PLACES.map((p) => [p.place, p] as const))("%s", (_name, p) => {
    const text = readFileSync(path.join(APP, p.file), "utf8");
    expect(p.line.test(text), `${p.file} lost its line for "${p.place}" (${p.line.source})`).toBe(true);
  });

  it("names each place once", () => {
    const names = CRITICAL_PLACES.map((p) => p.place);
    expect(new Set(names).size).toBe(names.length);
  });
});
