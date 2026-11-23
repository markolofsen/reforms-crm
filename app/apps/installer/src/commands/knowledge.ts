// P126 C1: `hub knowledge import|index|search|check <project> ...` (was the package CLI `pnpm --filter @hub/knowledge knowledge`).
import { createRepos, openDb } from "@hub/db";
import { defaultProjectsRoot } from "@hub/projects/registry";
import type { Command } from "commander";
import { checkProject, formatReport, importFromDump, importFromFiles, ImportError, indexProject, knowledgeSearch } from "@hub/knowledge";

export function registerKnowledgeCommands(parent: Command): Command {
  const program = parent.command("knowledge").description("Per-project knowledge: import, index, search, check.");
  program.option("--root <dir>", "projects folder (default: <HUB_HOME>/projects, or HUB_PROJECTS)").option("--db <file>", "database (default: HUB_DB or <HUB_HOME>/data/app.db)");

  const root = (): string => (program.opts().root as string | undefined) ?? defaultProjectsRoot();
  const withRepos = async <T>(fn: (r: ReturnType<typeof createRepos>) => Promise<T>): Promise<T> => {
    const handle = openDb(program.opts().db as string | undefined);
    try {
      return await fn(createRepos(handle.db));
    } finally {
      handle.close();
    }
  };

  program
    .command("import")
    .description("Fill knowledge/ from the newest Notion dump or from files.")
    .argument("<project>")
    .option("--from-dump", "read the newest complete dump under <project>/dumps (knowledge database)")
    .option("--dump <dir>", "a specific dump folder (with --from-dump)")
    .option("--from-files <path>", "validate and copy .md entries from a file or folder into knowledge/files")
    .action((slug: string, o: { fromDump?: boolean; dump?: string; fromFiles?: string }) => {
      if (!!o.fromDump === !!o.fromFiles) throw new ImportError("choose exactly one of --from-dump or --from-files <path>");
      if (o.fromDump) {
        const r = importFromDump(root(), slug, o.dump ? { dumpDir: o.dump } : {});
        console.log(`imported dump ${r.dump}: ${r.pages} pages (${r.approved} approved), ${r.written} written, ${r.unchanged} unchanged, ${r.removed} removed, ${r.truncated} truncated`);
      } else {
        const r = importFromFiles(root(), slug, o.fromFiles as string);
        console.log(`files: ${r.copied} copied, ${r.unchanged} unchanged, ${r.invalid.length} invalid`);
        for (const i of r.invalid) console.log(`invalid ${i.path}: ${i.error}`);
        if (r.invalid.length) process.exitCode = 1;
      }
      console.log(`next: hub knowledge index ${slug}`);
    });

  program
    .command("index")
    .description("Incremental reindex of knowledge/ into the database.")
    .argument("<project>")
    .action(async (slug: string) => {
      const r = await withRepos((repos) => indexProject(repos, root(), slug));
      console.log(`indexed ${slug}: ${r.files} files, ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged, ${r.deleted} deleted, ${r.invalid.length} invalid`);
      for (const i of r.invalid) console.log(`invalid ${i.path}: ${i.error}`);
      for (const w of r.warnings) console.log(`warning ${w.path}: ${w.message}`);
      if (r.invalid.length) process.exitCode = 1;
    });

  program
    .command("search")
    .description("Search one project's knowledge (the same call the MCP tool makes).")
    .argument("<project>")
    .argument("<query>")
    .option("--audience <audience>")
    .option("--limit <n>", "1..10", (v) => Number.parseInt(v, 10))
    .option("--include <mode>", "approved (default) or all")
    .option("--json", "print the tool's JSON")
    .action(async (slug: string, query: string, o: { audience?: string; limit?: number; include?: "approved" | "all"; json?: boolean }) => {
      const res = await withRepos((repos) => knowledgeSearch(repos, { project: slug, query, audience: o.audience, limit: o.limit, include: o.include }));
      if (o.json) return void console.log(JSON.stringify(res, null, 2));
      console.log(`${res.total} match(es) for "${query}" in ${slug}${res.truncated ? " (showing the top)" : ""}`);
      res.results.forEach((h, i) => console.log(`${i + 1}. ${h.title}  [${h.use}${h.approved ? "" : ", unapproved"}${h.expired ? ", expired" : ""}]  ${h.path}\n   ${h.snippet.replace(/\s+/g, " ")}`));
    });

  program
    .command("check")
    .description("Counts and gaps: unapproved, expired, no audiences, no phrasings; files vs index.")
    .argument("<project>")
    .option("--json")
    .action(async (slug: string, o: { json?: boolean }) => {
      const r = await withRepos((repos) => checkProject(repos, root(), slug));
      console.log(o.json ? JSON.stringify(r, null, 2) : formatReport(r));
      if (!r.consistent) process.exitCode = 1;
    });

  return program;
}
