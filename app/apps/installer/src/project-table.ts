import { doctorProject, loadProjects, type Check, type LoadedProject } from "@hub/projects";

export interface ProjectRow { slug: string; kind: string; status: string; failed: number; passed: number; skipped: number; firstFailure: string }

export interface ProjectTableOptions {
  mailAccounts?: () => Promise<string[]>;
  notionCheck?: (p: LoadedProject) => Promise<{ ok: boolean; detail: string }>;
}

/**
 * W5: one row per project (every folder with a project.md, `_*` excluded, paused ones included and marked).
 * Read only: it never edits project.md, so a project's `status` is changed by the owner (or the setup skill), not by a check.
 */
export async function projectRows(projectsDir: string, o: ProjectTableOptions = {}): Promise<ProjectRow[]> {
  const all = loadProjects(projectsDir);
  const mail = o.mailAccounts ? await o.mailAccounts().catch(() => []) : [];
  const rows: ProjectRow[] = [];
  for (const project of all) {
    const checks: Check[] = await doctorProject({
      project,
      all,
      ...(mail.length ? { mailAccounts: mail } : {}),
      ...(o.notionCheck ? { notionCheck: () => o.notionCheck!(project) } : {}),
    });
    const first = checks.find((c) => c.outcome === "fail");
    rows.push({
      slug: project.slug,
      kind: project.parsed.config.kind,
      status: project.parsed.config.status,
      failed: checks.filter((c) => c.outcome === "fail").length,
      passed: checks.filter((c) => c.outcome === "pass").length,
      skipped: checks.filter((c) => c.outcome === "skipped").length,
      firstFailure: first ? `${first.name}: ${first.detail}` : "",
    });
  }
  return rows;
}

export function projectTable(rows: ProjectRow[]): string {
  if (!rows.length) return "No projects yet: `hub agent new`, then say \"настрой проект <имя>\".";
  const w = Math.max(...rows.map((r) => r.slug.length), 7);
  const k = Math.max(...rows.map((r) => r.kind.length), 4);
  const head = `${"".padEnd(5)} ${"project".padEnd(w)}  ${"kind".padEnd(k)}  ${"status".padEnd(8)}  checks`;
  const lines = rows.map((r) => `${(r.failed ? "FAIL" : "PASS").padEnd(5)} ${r.slug.padEnd(w)}  ${r.kind.padEnd(k)}  ${r.status.padEnd(8)}  ${r.passed} pass, ${r.failed} fail, ${r.skipped} skipped${r.firstFailure ? `; first: ${r.firstFailure}` : ""}`);
  return [head, ...lines].join("\n");
}
