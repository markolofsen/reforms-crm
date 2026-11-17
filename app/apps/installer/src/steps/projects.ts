import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkDev } from "@hub/projects/dev";
import { listProjects } from "../context.ts";
import type { Step } from "../types.ts";
import { fail, pass } from "./helpers.ts";

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
