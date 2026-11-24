import { isPolicyField, POLICY_FIELDS, type PolicyField } from "@hub/projects/fields";
import { projectStore, type LoadedProject } from "@hub/projects/store";
import { migrateSendPolicy, setSendPolicy, type SendPolicy } from "@hub/projects/send-policy";
import { autopilotOf, isAutopilotDisclose, isAutopilotMode, setAutopilot, type AutopilotChange } from "@hub/projects/autopilot";
import { AUTOPILOT_DISCLOSE, AUTOPILOT_MODES } from "@hub/config/autopilot";
import { inAgentSession } from "../commands/sequences";

// `hub send policy`: the one command that writes a project's send policy (P49 S11). A person runs it in their own
// shell; an agent's session cannot (deny rules on `hub send`, and the sandbox cannot write state/projects).

export interface PolicyCommandEnv {
  projectsDir: string;
  /** `hubPaths().stateProjects`. */
  policyDir: string;
  out?: (l: string) => void;
  now?: () => Date;
  /** Tests: the environment that tells a session from a person's shell. */
  env?: NodeJS.ProcessEnv;
}

const USAGE = `usage: hub send policy [<slug>] | set <slug> <field> <value> [<field> <value> ...] | migrate [<slug>] [--dry-run]
       hub send policy autopilot <slug> [mode ${AUTOPILOT_MODES.join("|")} | chat <channel>:<chatId> on|off | disclose ${AUTOPILOT_DISCLOSE.join("|")}]
fields: ${POLICY_FIELDS.join(", ")} (an empty value "" restores the default)`;

const autopilotLine = (slug: string, p: SendPolicy): string => {
  const a = autopilotOf(p);
  return `${slug}: autopilot ${a.mode}; chats ${a.chats.join(", ") || "(none)"}; disclose ${a.disclose}; quiet ${a.quiet ? `${a.quiet.from}-${a.quiet.to} ${a.quiet.tz}` : "off"}`;
};

/** The change `autopilot <slug> <what> <value...>` names, or the sentence why not. */
function autopilotChange(what: string | undefined, rest: string[]): AutopilotChange | string {
  if (what === "mode" && rest.length === 1 && isAutopilotMode(rest[0])) return { kind: "mode", mode: rest[0] };
  if (what === "disclose" && rest.length === 1 && isAutopilotDisclose(rest[0])) return { kind: "disclose", disclose: rest[0] };
  if (what === "chat" && rest.length === 2 && rest[0] && (rest[1] === "on" || rest[1] === "off")) return { kind: "chat", chat: rest[0], on: rest[1] === "on" };
  return USAGE;
}

/**
 * Decision 0048 (P139 A1, verdict 31): `hub send policy autopilot`. Shows a project's autopilot block, or writes one change
 * through the send policy's one writer. A person's shell only: inside an agent session (Claude's `CLAUDECODE`, `hub agent`'s
 * `HUB_PROJECT`) it refuses before reading anything, as the deny rules on `hub send` already do.
 */
function runAutopilot(rest: string[], env: PolicyCommandEnv, find: (slug: string | undefined) => LoadedProject | undefined, out: (l: string) => void): number {
  if (inAgentSession(env.env ?? process.env)) {
    out("refused: autopilot is switched only by the owner (the admin's Autopilot switch, or this command in his own shell), never inside an agent session (decision 0048)");
    return 2;
  }
  const [slug, what, ...values] = rest;
  const project = find(slug);
  if (!project) { out(`no such project "${slug ?? ""}"\n${USAGE}`); return 2; }
  if (what === undefined) {
    const st = project.policy;
    if (st) out(autopilotLine(project.slug, st.policy));
    return 0;
  }
  const change = autopilotChange(what, values);
  if (typeof change === "string") { out(change); return 2; }
  try {
    out(autopilotLine(project.slug, setAutopilot(env.policyDir, project.slug, project.parsed.config.kind, change, "owner", env.now?.())));
    return 0;
  } catch (e) {
    out(`not written: ${(e as Error).message}`);
    return 2;
  }
}

const line = (slug: string, p: SendPolicy, source: string): string =>
  `${slug}: send.mode ${p.mode}; send.classes ${p.classes.join(", ") || "(none)"}; send.daily_cap ${p.dailyCap}; send.delay_minutes ${p.delayMinutes}; draft.recipients ${Array.isArray(p.recipients) ? p.recipients.join(", ") : p.recipients} (${source})`;

/** Exit codes: 0 ok, 2 refused or bad input. */
export function runPolicyCommand(args: string[], env: PolicyCommandEnv): number {
  const out = env.out ?? console.log;
  const all = (): LoadedProject[] => projectStore({ projects: env.projectsDir, stateProjects: env.policyDir }).list();
  const find = (slug: string | undefined): LoadedProject | undefined => all().find((p) => p.slug === slug);
  const [verb, ...rest] = args;

  if (verb === "autopilot") return runAutopilot(rest, env, find, out);

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
