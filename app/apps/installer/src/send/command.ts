import { createRepos, defaultDbPath, openDb, type SendRow } from "@hub/db";
import { readFileSync } from "node:fs";
import { mailAppMailer, runDue, sendDraft, type Mailer } from "@hub/send";

// The CLI face of send.ts: `hub send <draftId>`, `--due`, `--cancel`, `--stop`, `--resume`, `--status`.
// Dry run by default for the two that can send. The Mailer is injectable so tests never reach Mail.

export interface SendCommandOptions {
  draftId?: number;
  apply?: boolean;
  due?: boolean;
  project?: string;
  cancel?: number;
  stop?: boolean;
  resume?: boolean;
  status?: boolean;
}

export interface SendCommandEnv {
  projectsDir: string;
  /** `hubPaths().stateProjects`: the send policy files (P49 S11). */
  policyDir: string;
  configFile: string;
  dbPath?: string;
  mailer?: Mailer;
  out?: (l: string) => void;
  now?: () => Date;
}

function allowList(file: string): string[] {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { allow_list?: unknown };
    return Array.isArray(j.allow_list) ? j.allow_list.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

const brief = (r: SendRow) => `${String(r.id).padStart(4)} ${r.status.padEnd(9)} ${r.mode.padEnd(6)} ${r.project} draft ${r.draftId ?? "-"} to ${r.toAddr} "${r.subject}"${r.dueAt && r.status === "queued" ? ` due ${r.dueAt}` : ""}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`;

/** Returns the exit code: 0 ok, 1 failure while sending or writing, 2 refused or bad input. */
export async function runSendCommand(o: SendCommandOptions, env: SendCommandEnv): Promise<number> {
  const out = env.out ?? console.log;
  const modes = [o.draftId !== undefined, !!o.due, o.cancel !== undefined, !!o.stop, !!o.resume, !!o.status].filter(Boolean).length;
  if (modes !== 1) {
    out(JSON.stringify({ ok: false, error: "give exactly one of: <draftId>, --due, --cancel <sendId>, --stop, --resume, --status" }));
    return 2;
  }
  const handle = openDb(env.dbPath ?? defaultDbPath());
  try {
    const repos = createRepos(handle.db);
    const deps = { repos, mailer: env.mailer ?? mailAppMailer(), projectsDir: env.projectsDir, policyDir: env.policyDir, allowList: allowList(env.configFile), ...(env.now ? { now: env.now } : {}) };
    if (o.draftId !== undefined) {
      const r = await sendDraft(deps, { draftId: o.draftId, apply: !!o.apply, actor: "cli" });
      out(r.line);
      return r.code;
    }
    if (o.due) {
      const r = await runDue(deps, { apply: !!o.apply, ...(o.project ? { project: o.project } : {}) });
      out(JSON.stringify({ ok: r.code === 0, dryRun: !o.apply, ...r.report }));
      return r.code;
    }
    if (o.cancel !== undefined) {
      const r = await repos.sends.cancel(o.cancel, "cancelled by the owner");
      out(JSON.stringify(r ? { ok: true, cancelled: r.id } : { ok: false, error: `send ${o.cancel} is not queued (it may be sent, sending or unknown)` }));
      return r ? 0 : 2;
    }
    if (o.stop) {
      const n = await repos.sends.stop(o.project);
      out(JSON.stringify({ ok: true, stopped: o.project ?? "*", cancelledQueued: n }));
      return 0;
    }
    if (o.resume) {
      await repos.sends.resume(o.project);
      out(JSON.stringify({ ok: true, resumed: o.project ?? "*" }));
      return 0;
    }
    // --status
    const stopped = await repos.sends.stoppedScopes();
    out(`Stop all: ${stopped.length ? stopped.join(", ") : "off"}`);
    const rows = o.project ? await repos.sends.list(o.project, 20) : await repos.sends.queued();
    if (!rows.length) out(o.project ? "no sends yet" : "nothing queued (give --project <slug> for the last sends)");
    for (const r of rows) out(brief(r));
    return 0;
  } finally {
    handle.close();
  }
}
