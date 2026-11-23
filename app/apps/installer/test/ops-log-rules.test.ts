import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";

// Gate (P86, rules README rule 18): the server and every package write what failed or happened through the ops log
// (`ops(source)` of `@hub/log/ops`), never a raw `console.*`, so every line has a time, a level and a source, is redacted in one
// place and lands in `state/log/ops-<day>.jsonl`. A CLI's printed answer is not a log line: the files below print to the
// person who ran a command, each named with why. The installer (`apps/installer`, the `hub` CLI) is user output throughout and
// is not walked; its non-user failures (the log hook) write ops lines. The admin (`apps/admin`) runs in the browser and has its own
// rules. The check reads source text only.
const APP = path.join(CORE_ROOT, "app");
const ROOTS = ["apps/server/src", ...readdirSync(path.join(APP, "packages")).map((p) => `packages/${p}/src`)];
/** file -> why it may print with `console.*` */
const USER_OUTPUT: Record<string, string> = {
  "packages/db/src/seed-cli.ts": "`pnpm db:seed` prints what it added",
  "packages/db/src/migrate-cli.ts": "`pnpm db:migrate` prints the database it migrated (a failed migration is an ops line in openDb)",
  "packages/mail-filters/src/commands.ts": "`hub mail-filters` commands print through `o.out ?? console.log`",
  "packages/projects/src/commands.ts": "`hub project` commands print through `o.out ?? console.log`",
};
const CONSOLE = /\bconsole\.(log|warn|error|info|debug|trace)\b/;

function* walk(dir: string): Generator<string> {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const e of names) {
    if (["node_modules", "test", "tests", "e2e", "fixtures"].includes(e)) continue;
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) yield* walk(f);
    else if (/\.(ts|tsx|mjs)$/.test(e) && !/\.test\.tsx?$/.test(e)) yield f;
  }
}

describe("the ops log is the one log (P86)", () => {
  it("no console.* in the server or a package outside the CLI files that print to the user", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const f of walk(path.join(APP, root))) {
        const rel = path.relative(APP, f);
        if (rel in USER_OUTPUT) continue;
        readFileSync(f, "utf8").split("\n").forEach((line, i) => {
          if (CONSOLE.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
      }
    }
    expect(offenders, "write through ops(source) of @hub/log/ops, or add the file to USER_OUTPUT with why it prints to a person").toEqual([]);
  });

  it("every exempt file exists and still prints (a stale entry fails)", () => {
    for (const rel of Object.keys(USER_OUTPUT)) expect(CONSOLE.test(readFileSync(path.join(APP, rel), "utf8")), rel).toBe(true);
  });
});
