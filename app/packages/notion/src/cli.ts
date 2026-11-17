#!/usr/bin/env -S npx tsx
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { parseArgs } from "node:util";
import { runDump } from "./dump.js";
import { readFileSync } from "node:fs";
import { diffSchema, isClean, liveSchemaOf, renderDiff, type PackSchema } from "./schema-diff.js";
import { parseLeadPage, renderLeadSummary, summarizeLeads, type Lead } from "./leads.js";
import { createNotionReader } from "./notion.js";
import { loadProject } from "./project.js";
import { planRestore, renderPlan, resolveDumpDir } from "./restore.js";
import { loadToken, NoTokenError, secretsDir } from "./token.js";

/** The instance's projects folder: a bare project name (`acme`) resolves here. */
const projectArg = (arg: string): string => (/[\\/]|\.md$/.test(arg) ? arg : join(hubPaths().projects, arg));

const HELP = `notion-dump: read-only Notion backup.

  notion-dump dump <project> [--out DIR] [--date YYYY-MM-DD] [--only a,b] [--rps N] [--no-reuse] [--token-file NAME]
  notion-dump restore <project> --dry-run [--from DATE|PATH] [--out DIR] [--only a,b] [--json]
  notion-dump check <project>
  notion-dump diff <db|schema.json> --live <file|->   pack schema vs a live data source (the connector's fetch output, a file or stdin); exit 2 when they differ
  notion-dump leads <project> [--json]     what waits in the project's leads database: needs reply, overdue, won without a client

<project> is a name under the instance's projects folder, or a folder with project.md (or the path of project.md). The token comes from NOTION_TOKEN or
state/secrets/notion-token (or HUB_CONFIG_DIR; --token-file names another file in that folder) and is never printed. Nothing here writes to Notion.
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
      "token-file": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "no-reuse": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      live: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (positionals[0] === "diff") {
    const arg = positionals[1];
    if (!arg || !values.live) {
      process.stderr.write(HELP);
      return 64;
    }
    const file = /[\\/]|\.json$/.test(arg) ? arg : join(hubPaths().notionPack, "schema", `${arg}.json`);
    const pack = JSON.parse(readFileSync(file, "utf8")) as PackSchema;
    const live = liveSchemaOf(readFileSync(values.live === "-" ? 0 : values.live, "utf8"));
    const d = diffSchema(pack, live);
    process.stdout.write(values.json ? `${JSON.stringify(d, null, 2)}\n` : renderDiff(arg, d));
    return isClean(d) ? 0 : 2;
  }
  const [command, projectPath] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 64;
  }
  if (!["dump", "restore", "check", "leads"].includes(command) || !projectPath) {
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
  const tokenName = values["token-file"];
  if (tokenName !== undefined && !/^[A-Za-z0-9._-]+$/.test(tokenName)) {
    process.stderr.write("--token-file takes a file name in the secrets folder (no path)\n");
    return 64;
  }
  const reader = createNotionReader(await loadToken(process.env, tokenName ? join(secretsDir(), tokenName) : undefined), { rps });
  const log = (line: string) => process.stderr.write(`${line}\n`);

  if (command === "leads") {
    const db = project.databases.find((d) => d.slug === "leads");
    if (!db) {
      process.stderr.write("project.md lists no `leads` database.\n");
      return 1;
    }
    const leads: Lead[] = [];
    for await (const page of reader.listPages(db.dataSourceId)) leads.push(parseLeadPage(page));
    const summary = summarizeLeads(leads, today());
    process.stdout.write(values.json ? `${JSON.stringify(summary, null, 2)}\n` : renderLeadSummary(summary));
    return 0;
  }

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
