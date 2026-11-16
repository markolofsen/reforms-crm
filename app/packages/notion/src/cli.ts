#!/usr/bin/env -S npx tsx
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { parseArgs } from "node:util";
import { runDump } from "./dump.js";
import { createNotionReader } from "./notion.js";
import { loadProject } from "./project.js";
import { planRestore, renderPlan, resolveDumpDir } from "./restore.js";
import { loadToken, NoTokenError } from "./token.js";

/** The instance's projects folder: a bare project name (`acme`) resolves here. */
const projectArg = (arg: string): string => (/[\\/]|\.md$/.test(arg) ? arg : join(hubPaths().projects, arg));

const HELP = `notion-dump: read-only Notion backup.

  notion-dump dump <project> [--out DIR] [--date YYYY-MM-DD] [--only a,b] [--rps N] [--no-reuse]
  notion-dump restore <project> --dry-run [--from DATE|PATH] [--out DIR] [--only a,b] [--json]
  notion-dump check <project>

<project> is a name under the instance's projects folder, or a folder with project.md (or the path of project.md). The token comes from NOTION_TOKEN or
state/secrets/notion-token (or HUB_CONFIG_DIR) and is never printed. Nothing here writes to Notion.
Exit codes: 0 ok, 1 error, 2 some database failed, 3 no token, 64 usage.
`;

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      date: { type: "string" },
      from: { type: "string" },
      only: { type: "string" },
      rps: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "no-reuse": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, projectPath] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 64;
  }
  if (!["dump", "restore", "check"].includes(command) || !projectPath) {
    process.stderr.write(HELP);
    return 64;
  }
  if (command === "restore" && !values["dry-run"]) {
    process.stderr.write("restore only supports --dry-run: this tool never writes to Notion.\n");
    return 64;
  }

  const project = await loadProject(projectArg(projectPath));
  const outDir = values.out ?? join(project.folder, "dumps");
  const only = values.only?.split(",").map((s) => s.trim()).filter(Boolean);
  const rps = values.rps ? Number(values.rps) : 3;
  if (!Number.isFinite(rps) || rps <= 0) {
    process.stderr.write("--rps must be a positive number\n");
    return 64;
  }
  const reader = createNotionReader(await loadToken(), { rps });
  const log = (line: string) => process.stderr.write(`${line}\n`);

  if (command === "check") {
    let bad = 0;
    for (const db of project.databases) {
      try {
        const info = await reader.retrieveDataSource(db.dataSourceId);
        log(`ok      ${db.slug}: ${info.title} (${Object.keys(info.properties).length} properties)`);
      } catch (err) {
        bad++;
        log(`FAILED  ${db.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (bad) log("A failed database is usually not shared with the integration: share its teamspace root page.");
    return bad ? 2 : 0;
  }

  if (command === "dump") {
    const manifest = await runDump({
      project,
      outDir,
      date: values.date ?? today(),
      reader,
      ...(only ? { only } : {}),
      reuse: !values["no-reuse"],
      log,
    });
    const t = manifest.totals;
    process.stdout.write(
      `dump ${manifest.project} ${manifest.date}: ${t.databases} databases, ${t.pages} pages, ` +
        `${t.markdown_truncated} truncated, ${t.errors} errors, sha256 ${manifest.sha256.slice(0, 12)}\n` +
        `${join(outDir, manifest.date)}\n`,
    );
    return t.errors ? 2 : 0;
  }

  const dumpDir = await resolveDumpDir(outDir, values.from);
  const plan = await planRestore(dumpDir, reader, only);
  process.stdout.write(values.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan));
  return plan.totals.errors ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof NoTokenError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = 3;
      return;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
