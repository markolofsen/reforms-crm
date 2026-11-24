import { createRepos, defaultDbPath, openDb, type Repos } from "@hub/db";
import { headersFromText, resolveBrand } from "@hub/projects/brands";
import { projectStore } from "@hub/projects/store";
import { readEvents, type LogStore } from "@hub/log/store";
import { mailAppDraftWriter } from "@hub/mail-app/writer";

// `hub drafts heal-brands` (P140 R4, verdict 5): a draft record that adopted a pending Mail version (`draft_write` answered
// `adopted: true`) took its brand and the address the client wrote to from another write of the session's ledger, not from
// the version (saas draft 8: Reforms for a mail written to info@cmdop.ai). The truth is the answered message's own headers,
// read from Mail (read only) and resolved by the signer's resolver. Dry run unless `--apply`; a second run finds nothing to fix.
// A record the headers cannot settle (a new thread, a message no longer in Mail) is listed and left as it is: never guessed.

/** The answered message's raw headers, or null when Mail does not hold it (the command's Mail read; tests pass their own). */
export type HeadersOf = (accounts: readonly string[], messageId: string) => Promise<string | null>;

export interface HealBrandsEnv {
  projectsDir: string;
  policyDir: string;
  log: LogStore;
  dbPath?: string;
  headersOf?: HeadersOf;
  out?: (l: string) => void;
}

export type HealRow = { project: string; draftId: number; from: { brand: string | null; wroteTo: string | null }; to: { brand: string | null; wroteTo: string | null } | null; state: "fix" | "ok" | "unsettled"; why: string };

const mailHeaders = (): HeadersOf => {
  const writer = mailAppDraftWriter();
  return async (accounts, messageId) => {
    const found = await writer.findInbound(accounts, messageId);
    return found ? await writer.readHeaders(found) : null;
  };
};

/** The draft ids `draft_write` recorded by adopting a pending version, from the project's session log. */
export function adoptedDraftIds(log: LogStore, project: string): number[] {
  const ids = new Set<number>();
  for (const e of readEvents(log, { project, kinds: ["tool_result"] })) {
    if (e.data.tool !== "mcp__hub__draft_write" || typeof e.data.output !== "string") continue;
    try {
      const out: unknown = JSON.parse(e.data.output);
      if (!out || typeof out !== "object" || !("adopted" in out) || out.adopted !== true || !("record" in out)) continue;
      const rec = out.record;
      if (rec && typeof rec === "object" && "draftId" in rec && typeof rec.draftId === "number") ids.add(rec.draftId);
    } catch {
      /* a cut line is not a record */
    }
  }
  return [...ids].sort((a, b) => a - b);
}

async function judge(repos: Repos, project: string, draftId: number, cfg: Parameters<typeof resolveBrand>[1] & { mail: { accounts: readonly string[] } }, headersOf: HeadersOf): Promise<HealRow> {
  const d = await repos.drafts.get(draftId);
  const from = { brand: d?.brand ?? null, wroteTo: d?.wroteTo ?? null };
  if (!d || d.project !== project) return { project, draftId, from, to: null, state: "unsettled", why: "no such draft in this project" };
  if (!d.mailRef) return { project, draftId, from, to: null, state: "unsettled", why: "a new thread answers no message: its brand was named, not read from headers" };
  const raw = await headersOf(cfg.mail.accounts, d.mailRef).catch(() => null);
  if (!raw) return { project, draftId, from, to: null, state: "unsettled", why: "the answered message is not in this project's Mail (or Mail is not running)" };
  const r = resolveBrand(headersFromText(raw), cfg);
  // Skip rather than guess: headers that name no brand settle nothing.
  if (!r.brand) return { project, draftId, from, to: null, state: "unsettled", why: r.reason };
  const to = { brand: r.brand, wroteTo: r.wroteTo };
  const same = to.brand === from.brand && to.wroteTo === from.wroteTo;
  return { project, draftId, from, to, state: same ? "ok" : "fix", why: r.reason };
}

const show = (x: { brand: string | null; wroteTo: string | null }) => `${x.brand ?? "(no brand)"} / ${x.wroteTo ?? "(none)"}`;

/** Exit code: 0 done (dry run, nothing to fix, or every fix read back), 1 a fix did not read back, 2 bad input. */
export async function runHealBrands(o: { project?: string; apply?: boolean }, env: HealBrandsEnv): Promise<number> {
  const out = env.out ?? console.log;
  const projects = projectStore({ projects: env.projectsDir, stateProjects: env.policyDir }).list().filter((p) => !o.project || p.slug === o.project);
  if (projects.length === 0) {
    out(JSON.stringify({ ok: false, error: o.project ? `no project ${o.project}` : "no projects" }));
    return 2;
  }
  const headersOf = env.headersOf ?? mailHeaders();
  const handle = openDb(env.dbPath ?? defaultDbPath());
  try {
    const repos = createRepos(handle.db);
    const rows: HealRow[] = [];
    for (const p of projects) {
      const cfg = p.parsed.config;
      for (const id of adoptedDraftIds(env.log, p.slug)) rows.push(await judge(repos, p.slug, id, cfg, headersOf));
    }
    const fixes = rows.filter((r) => r.state === "fix");
    out(`${o.apply ? "Healing" : "Dry run, nothing changed"}: ${rows.length} adopted record${rows.length === 1 ? "" : "s"}, ${fixes.length} to fix.`);
    for (const r of rows) out(`${r.project} draft ${r.draftId}: ${r.state.padEnd(9)} ${show(r.from)}${r.to && r.state === "fix" ? ` -> ${show(r.to)}` : ""}  (${r.why})`);
    if (!o.apply || fixes.length === 0) {
      out(JSON.stringify({ ok: true, dryRun: !o.apply, adopted: rows.length, fix: fixes.length, unsettled: rows.filter((r) => r.state === "unsettled").length }));
      return 0;
    }
    const failed: number[] = [];
    for (const r of fixes) {
      const to = r.to!;
      await repos.drafts.setBrandOf(r.project, r.draftId, to);
      await repos.mailVersions.setBrandOfDraft(r.draftId, to);
      const back = await repos.drafts.get(r.draftId);
      if (back?.brand !== to.brand || back?.wroteTo !== to.wroteTo) failed.push(r.draftId);
      else out(`${r.project} draft ${r.draftId}: read back ${show({ brand: back.brand, wroteTo: back.wroteTo })}`);
    }
    out(JSON.stringify({ ok: failed.length === 0, dryRun: false, fixed: fixes.length - failed.length, failed }));
    return failed.length ? 1 : 0;
  } finally {
    handle.close();
  }
}
