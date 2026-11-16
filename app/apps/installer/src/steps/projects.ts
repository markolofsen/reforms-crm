import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listProjects } from "../context.ts";
import type { Step } from "../types.ts";
import { fail, pass } from "./helpers.ts";

export const projectSteps: Step[] = [
  {
    id: "projects.registry", group: "Projects", title: "Projects (one folder each)",
    why: "One workflow serves several projects. A project is just a folder `<projects>/<slug>/` (`app/projects/` in the single-repo layout) with `project.md` and a `knowledge/` folder; no settings screen.",
    verifies: "Every `<projects>/<slug>/` has a non-empty `project.md` and a `knowledge/` folder. With no projects folder the workflow runs as a single project.",
    does: "Creates the missing `knowledge/` folders. `project.md` is written by the project-setup skill, never by the installer.",
    async check(ctx) {
      const slugs = listProjects(ctx);
      if (!slugs.length) return pass("single-project mode (no projects folder)");
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
];
