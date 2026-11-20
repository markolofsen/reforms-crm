import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hubPaths } from "@hub/config/paths";
import { KINDS } from "@hub/projects";

/**
 * P89: the first project of a new instance (or of a starter), from a kind. The files the `project-setup` skill's step 5 names:
 * `project.md` with the schema, kind, name and status rows (status draft), the template's workflows, sequences and `@dev`, the kind's
 * taxonomy as `knowledge/taxonomy.md`, an empty `knowledge/files/`. The interview ("настрой проект <slug>") fills everything else.
 * Never overwrites: an existing project folder is refused.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class ProjectScaffoldError extends Error {}

const taxonomyText = (t: { audiences: string[]; category: string[]; stages: string[] }): string => {
  const parts = [
    "# Knowledge taxonomy",
    "",
    "The words entries of this project may use. `audiences` is enforced by `knowledge index`; the other sections only warn. Started from the project's kind; the project owns this file now. Rule: `core/@docs/core/16-projects-and-knowledge.md`.",
  ];
  for (const [axis, words] of Object.entries(t)) if (words.length) parts.push("", `## ${axis}`, words.join(", "));
  return `${parts.join("\n")}\n`;
};

export function projectMd(slug: string, kind: string, date: string): string {
  return [
    `# ${slug}`,
    "",
    "> Layer: **custom** (this instance). Universal logic: `core/skills/` and `core/@docs/core/`. Rule: `core/@docs/LAYERS.md`.",
    "",
    "What this project is, in one paragraph: [Owner: who the clients are, which mail and Notion teamspace it uses]. Start a session with `./run.sh agent " + slug + "` and say «настрой проект " + slug + "»: the project-setup skill asks the rest and fills this file.",
    "",
    "## Settings",
    "",
    "| Field | Value | Answered | By |",
    "|---|---|---|---|",
    `| schema | 1 | ${date} | default |`,
    `| kind | ${kind} | ${date} | owner |`,
    `| name | ${slug} | ${date} | owner |`,
    `| status | draft | ${date} | default |`,
    "",
    "## Notion databases",
    "",
    "",
  ].join("\n");
}

const KNOWLEDGE_README = [
  "# Knowledge",
  "",
  "One Markdown file per fact the agent may use in a reply, under `files/` (prices, terms, how-tos). An example entry:",
  "",
  "```md",
  "---",
  "title: Refund window",
  "audiences: [CLIENT]",
  "valid_until: 2027-12-31",
  "---",
  "Refunds are possible within 14 days of payment. [Owner: the real rule]",
  "```",
  "",
  "The words allowed in `audiences`, `category` and `stages` are in `taxonomy.md`. Rules: `core/@docs/core/16-projects-and-knowledge.md`.",
  "",
].join("\n");

/** Writes `projects/<slug>/` into `home` from the template of `coreRoot`. Returns the paths written, relative to `home`. */
export function scaffoldProject(home: string, coreRoot: string, slug: string, kind: string, date: string): string[] {
  if (!SLUG_RE.test(slug)) throw new ProjectScaffoldError(`project slug "${slug}" must be lower case letters, digits and dashes`);
  const k = KINDS[kind];
  if (!k) throw new ProjectScaffoldError(`unknown kind "${kind}"; kinds: ${Object.keys(KINDS).join(", ")}`);
  const dir = path.join(home, "projects", slug);
  if (existsSync(dir)) throw new ProjectScaffoldError(`${dir} exists: a project is never overwritten`);
  // The template folder is the parent of the Notion pack, as @hub/config/paths states it (no second spelling of the path).
  const tpl = path.dirname(hubPaths({ core: coreRoot, home, env: {} }).notionPack);
  mkdirSync(path.join(dir, "knowledge", "files"), { recursive: true });
  writeFileSync(path.join(dir, "project.md"), projectMd(slug, kind, date));
  writeFileSync(path.join(dir, "knowledge", "taxonomy.md"), taxonomyText(k.taxonomy));
  writeFileSync(path.join(dir, "knowledge", "README.md"), KNOWLEDGE_README);
  writeFileSync(path.join(dir, "knowledge", "files", ".gitkeep"), "");
  const out = [`projects/${slug}/project.md`, `projects/${slug}/knowledge/`];
  for (const sub of ["workflows", "sequences", "@dev"]) {
    const src = path.join(tpl, sub);
    if (!existsSync(src)) continue;
    cpSync(src, path.join(dir, sub), { recursive: true });
    out.push(`projects/${slug}/${sub}/`);
  }
  return out;
}
