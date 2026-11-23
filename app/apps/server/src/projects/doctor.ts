import { doctorProject } from "@hub/projects/doctor";
import { projectStore } from "@hub/projects/store";
import { loadToken, secretsDir } from "@hub/notion";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "@hub/db";
import { doctorDto, type DoctorDto } from "@hub/contract/sending";

export const countMarkdown = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countMarkdown(join(dir, e.name)) : e.name.endsWith(".md") ? 1 : 0), 0);
};

/**
 * `hub project doctor` for Settings ▸ Sending and Overview's setup part: the same checks (`@hub/projects`). The server reads files and the
 * index only; the checks that need Mail.app or Notion are not run here and come back as skipped, with one exception:
 * the Notion token always exists (owner decision 2026-11-15), so a missing token file is a failure here, found without
 * any network call. A present token leaves the databases check skipped: reading them is the Overview's Refresh.
 */
export async function projectDoctor(repos: Repos, slug: string, root: string, env: NodeJS.ProcessEnv = process.env, policyDir?: string): Promise<DoctorDto> {
  const all = projectStore({ projects: root, ...(policyDir ? { stateProjects: policyDir } : {}) }).list();
  const project = all.find((p) => p.slug === slug);
  if (!project) return doctorDto.parse({ state: "absent", checks: [], facts: null });
  const tokenFile = project.parsed.config.notion.tokenFile;
  const hasToken = await loadToken(tokenFile === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), tokenFile)).then(
    () => true,
    () => false,
  );
  const registered = (await repos.projects.get(slug)) !== null;
  const checks = await doctorProject({
    project,
    all,
    ...(registered ? { knowledgeDocs: await repos.knowledge.count(slug) } : {}),
    knowledgeFiles: countMarkdown(join(project.folder, "knowledge")),
    ...(registered ? { leadWrites: await repos.leadRows.lastConvertNote(slug).then((r) => (r ? { note: r.note, at: r.at } : null)) } : {}),
    ...(hasToken ? {} : { notionCheck: async () => ({ ok: false, detail: `no Notion token: put it alone in state/secrets/${tokenFile} (chmod 600), then run hub doctor ${slug}` }) }),
  });
  const c = project.parsed.config;
  const recipients = c.draft.recipients === "test" || c.draft.recipients === "any" ? c.draft.recipients : "list";
  const listed = Array.isArray(c.draft.recipients) ? c.draft.recipients.length : 0;
  const autosend = { mode: c.send.mode, classes: [...c.send.classes], dailyCap: c.send.dailyCap };
  return doctorDto.parse({ state: "ok", checks, facts: { status: c.status, accounts: c.mail.accounts, recipients, listed, autosend } });
}
