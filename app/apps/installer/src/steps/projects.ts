import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRepos, openDbReadOnly } from "@hub/db";
import { indexDrift } from "@hub/knowledge/drift";
import { checkDev } from "@hub/projects/dev";
import { listProjects } from "../context";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

export const projectSteps: Step[] = [
  {
    id: "projects.registry", group: "Projects", title: "Projects (one folder each)",
    why: "One workflow serves several projects. A project is just a folder `<projects>/<slug>/` with `project.md` and a `knowledge/` folder; no settings screen.",
    verifies: "Every `<projects>/<slug>/` has a non-empty `project.md` and a `knowledge/` folder. With no project yet there is nothing to check.",
    does: "Creates the missing `knowledge/` folders. `project.md` is written by the project-setup skill, never by the installer.",
    async check(ctx) {
      const slugs = listProjects(ctx);
      if (!slugs.length) return pass("no projects yet");
      const bad: string[] = [];
      for (const s of slugs) {
        const md = path.join(ctx.paths.projects, s, "project.md");
        if (!existsSync(md) || !readFileSync(md, "utf8").trim()) bad.push(`${s}: project.md missing or empty`);
        if (!existsSync(path.join(ctx.paths.projects, s, "knowledge"))) bad.push(`${s}: knowledge/ missing`);
      }
      return bad.length ? fail(bad.join("; ")) : pass(slugs.join(", "));
    },
    async apply(ctx) {
      for (const s of listProjects(ctx)) {
        const md = path.join(ctx.paths.projects, s, "project.md");
        if (!existsSync(md) || !readFileSync(md, "utf8").trim()) throw new Error(`${s}: project.md is missing; run the project-setup skill`);
        mkdirSync(path.join(ctx.paths.projects, s, "knowledge"), { recursive: true });
      }
      return "knowledge folders created";
    },
  },
  {
    id: "knowledge.index", group: "Projects", title: "The knowledge index says what the entry files say",
    why: "P140 K1: the entry files under `<projects>/<slug>/knowledge/` are the source; `knowledge_search` reads the index. The server reindexes a project at start and when a file changes, so an index that disagrees with its files means a reindex did not run (on 2026-11-24 a saas index carried no brands for a week while every file named one).",
    verifies: "Every indexable entry file of every project has its index row with the file's content hash and canonical `brands`, and no row is left without its file. Read only (the database opened read-only). FAIL names the paths that differ and the fix: `hub knowledge index <slug>`.",
    async check(ctx) {
      const slugs = listProjects(ctx).filter((s) => existsSync(path.join(ctx.paths.projects, s, "knowledge")));
      if (!slugs.length) return pass("no project has a knowledge folder");
      if (!existsSync(ctx.paths.db)) return warn("no app database yet (see files.app-db)");
      const h = openDbReadOnly(ctx.paths.db);
      try {
        const repos = createRepos(h.db);
        const bad: string[] = [];
        let entries = 0;
        for (const s of slugs) {
          const drift = await indexDrift(repos, ctx.paths.projects, s);
          entries += (await repos.knowledge.list(s)).length;
          if (drift.length) bad.push(`${s}: ${drift.length} differ (${drift.slice(0, 3).map((d) => `${d.path} ${d.reason}`).join(", ")}${drift.length > 3 ? ", …" : ""}); fix: \`hub knowledge index ${s}\``);
        }
        return bad.length ? fail(bad.join("; ")) : pass(`${entries} indexed entries match their files (${slugs.join(", ")})`);
      } finally {
        h.close();
      }
    },
  },
  {
    id: "dev.kanban", group: "Projects", title: "Project development kanban (@dev)",
    why: "Each project keeps its development plans in its own `<projects>/<slug>/@dev/`, the same kanban method as the Hub's own: the directory is the status and the README table is generated.",
    verifies: "Every project has `@dev/` (WARN when missing; `hub dev init <slug> --apply` creates it), its README track table matches the directories (`hub dev index <slug>` regenerates it) and no plan's `Status:` contradicts its directory (FAIL otherwise). Read only: `hub install` never creates it.",
    async check(ctx) {
      const slugs = listProjects(ctx);
      if (!slugs.length) return pass("no projects yet");
      const rs = slugs.map((s) => checkDev(s, path.join(ctx.paths.projects, s)));
      const level = rs.some((r) => r.level === "fail") ? "fail" : rs.some((r) => r.level === "warn") ? "warn" : "pass";
      return { level, detail: rs.filter((r) => level === "pass" || r.level === level).map((r) => r.detail).join("; ") };
    },
  },
];
