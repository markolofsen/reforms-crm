import { isPolicyField, POLICY_FIELDS, type PolicyField } from "@hub/projects/fields";
import { projectStore, type LoadedProject } from "@hub/projects/store";
import { migrateSendPolicy, setSendPolicy, type SendPolicy } from "@hub/projects/send-policy";

// `hub send policy`: the one command that writes a project's send policy (P49 S11). A person runs it in their own
// shell; an agent's session cannot (deny rules on `hub send`, and the sandbox cannot write state/projects).

export interface PolicyCommandEnv {
  projectsDir: string;
  /** `hubPaths().stateProjects`. */
  policyDir: string;
  out?: (l: string) => void;
  now?: () => Date;
}

const USAGE = `usage: hub send policy [<slug>] | set <slug> <field> <value> [<field> <value> ...] | migrate [<slug>] [--dry-run]
fields: ${POLICY_FIELDS.join(", ")} (an empty value "" restores the default)`;

const line = (slug: string, p: SendPolicy, source: string): string =>
  `${slug}: send.mode ${p.mode}; send.classes ${p.classes.join(", ") || "(none)"}; send.daily_cap ${p.dailyCap}; send.delay_minutes ${p.delayMinutes}; draft.recipients ${Array.isArray(p.recipients) ? p.recipients.join(", ") : p.recipients} (${source})`;

/** Exit codes: 0 ok, 2 refused or bad input. */
export function runPolicyCommand(args: string[], env: PolicyCommandEnv): number {
  const out = env.out ?? console.log;
  const all = (): LoadedProject[] => projectStore({ projects: env.projectsDir, stateProjects: env.policyDir }).list();
  const find = (slug: string | undefined): LoadedProject | undefined => all().find((p) => p.slug === slug);
  const [verb, ...rest] = args;

  if (verb === "set") {
    const [slug, ...pairs] = rest;
    const project = find(slug);
    if (!project || pairs.length === 0 || pairs.length % 2 !== 0) { out(project ? USAGE : `no such project "${slug ?? ""}"\n${USAGE}`); return 2; }
    const values: Partial<Record<PolicyField, string>> = {};
    for (let i = 0; i < pairs.length; i += 2) {
      const field = pairs[i] as string;
      if (!isPolicyField(field)) { out(`"${field}" is not a send-policy field (${POLICY_FIELDS.join(", ")})`); return 2; }
      values[field] = pairs[i + 1] as string;
    }
    try {
      const p = setSendPolicy(env.policyDir, project.slug, project.parsed.config.kind, values, "owner", env.now?.());
      out(line(project.slug, p, "written"));
      return 0;
    } catch (e) {
      out(`not written: ${(e as Error).message}`);
      return 2;
    }
  }

  if (verb === "migrate") {
    const dry = rest.includes("--dry-run");
    const slug = rest.find((a) => !a.startsWith("-"));
    const targets = slug ? [find(slug)].filter((p): p is LoadedProject => !!p) : all();
    if (slug && targets.length === 0) { out(`no such project "${slug}"`); return 2; }
    let code = 0;
    for (const project of targets) {
      try {
        const r = migrateSendPolicy(project, env.policyDir, { apply: !dry, by: "migrate", ...(env.now ? { now: env.now() } : {}) });
        const what = { moved: `moved ${r.removed.join(", ")} from project.md`, created: "no rows: wrote the defaults", kept: `send-policy.json already set; removed ${r.removed.join(", ")} from project.md without applying them`, none: "already migrated" }[r.outcome];
        out(`${dry ? "(dry run) " : ""}${what}\n  ${line(r.slug, r.policy, "policy")}`);
      } catch (e) {
        out(`${project.slug}: not migrated: ${(e as Error).message}`);
        code = 2;
      }
    }
    return code;
  }

  if (verb !== undefined && rest.length) { out(USAGE); return 2; }
  const targets = verb ? [find(verb)].filter((p): p is LoadedProject => !!p) : all();
  if (verb && targets.length === 0) { out(`no such project "${verb}"\n${USAGE}`); return 2; }
  for (const p of targets) {
    const st = p.policy;
    if (!st) continue;
    out(line(p.slug, st.policy, st.error ? `unreadable, defaults apply: ${st.error}` : st.source === "file" ? `${st.file}` : "no file: defaults"));
    const left = Object.keys(p.parsed.policyRows);
    if (left.length) out(`  project.md still has ${left.join(", ")} (ignored): hub send policy migrate ${p.slug}`);
  }
  return 0;
}
