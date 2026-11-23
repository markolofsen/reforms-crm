import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { checkProject } from "@hub/knowledge";
import { parseRulesFile } from "@hub/mail-filters";
import { projectStore } from "@hub/projects";
import type { Repos } from "@hub/db";
import { projectOverviewDto, type ProjectOverviewDto } from "@hub/contract/responses";

/** The instance's projects folder (HUB_PROJECTS, else under HUB_HOME): the same folder the CLIs read. */
export const projectsRoot = () => hubPaths().projects;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Knowledge = ProjectOverviewDto["knowledge"];
type Filters = ProjectOverviewDto["filters"];

async function knowledgeOf(repos: Repos, root: string, slug: string): Promise<Knowledge> {
  if (!existsSync(join(root, slug, "knowledge"))) return { state: "absent" };
  try {
    const r = await checkProject(repos, root, slug);
    return {
      state: "ok",
      indexed: r.indexed,
      approved: r.approved,
      unapproved: r.unapproved,
      expired: r.expired,
      noAudiences: r.noAudiences,
      noPhrasings: r.noPhrasings,
      problems: r.invalid.length + r.notIndexed.length + r.orphanRows.length,
      consistent: r.consistent,
      examples: [...r.examples.expired, ...r.examples.unapproved].slice(0, 5),
    };
  } catch (e) {
    return { state: "error", message: message(e) };
  }
}

function filtersOf(root: string, slug: string): Filters {
  const file = join(root, slug, "mail-filters.md");
  if (!existsSync(file)) return { state: "absent" };
  try {
    const { file: rules, issues } = parseRulesFile(readFileSync(file, "utf8"));
    return { state: "ok", rules: rules.rules.length, whitelist: rules.whitelist.length, issues: issues.slice(0, 5).map((i) => `line ${i.line}: ${i.message}`) };
  } catch (e) {
    return { state: "error", message: message(e) };
  }
}

/** One project's profile, open setup question, knowledge index and mail filters, read from its folder and the index. */
export async function projectOverview(repos: Repos, slug: string, root: string = projectsRoot(), policyDir?: string): Promise<ProjectOverviewDto> {
  const row = await repos.projects.get(slug);
  // `questions` refuses a slug that is not registered; a project known only by its clients has no setup state.
  const open = row ? await repos.projects.questions(slug, "open") : [];
  const q = open[0];
  let messengerPolicy: ProjectOverviewDto["messengerPolicy"] = null;
  if (row) {
    try {
      const config = projectStore({ projects: root, ...(policyDir ? { stateProjects: policyDir } : {}) }).config(slug);
      messengerPolicy = { language: config.messengers.language, instruction: config.messengers.instruction };
    } catch {
      messengerPolicy = null;
    }
  }
  return projectOverviewDto.parse({
    project: row ? { slug: row.slug, name: row.name, status: row.status, kind: row.kind, archived: row.archived, syncedAt: row.syncedAt } : null,
    question: q ? { question: q.question, options: q.optionsJson ? JSON.parse(q.optionsJson) : [] } : null,
    messengerPolicy,
    knowledge: await knowledgeOf(repos, root, slug),
    filters: filtersOf(root, slug),
  });
}
