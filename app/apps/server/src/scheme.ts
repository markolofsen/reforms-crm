import type { AgentToolRow, AgentToolsDto } from "@hub/contract/agent-tools";
import type { ConnectionsDto, ConnectionDto } from "@hub/contract/connections";
import type { HealthDto } from "@hub/contract/health";
import type { CoreUpdateDto } from "@hub/contract/instance";
import type { DoctorDto, ProjectOverviewDto } from "@hub/contract/responses";
import { phrase } from "@hub/contract/help";
import { schemeDto, type SchemeDto, type SchemeNode, type SchemeState } from "@hub/contract/scheme";
import type { CliFactDto } from "@hub/contract/terminal";
import type { LlmMonth } from "@hub/db";

/**
 * The Hub's parts and how each stands (P63 O1): a pure function over readers the server already has, so its test needs no Mail,
 * Notion or CLI. It never runs a check of its own: the Agent tools rows come from the cache only (no cached row: "Not checked
 * here", with "Run the check on Settings ▸ Agent"), Mail's account list is read within a short budget, and the CLIs are the detector's last
 * answer. Mapping (plan section 4a): pass, fresh, running, found → ok; warn, stale → warn; fail, error, not found → fail;
 * skipped, skip, never, off, nothing cached → unknown. A fix line is the source's own, never invented here.
 */
export interface SchemeSources {
  /** The registered projects that are not archived, in order. */
  projects: () => Promise<string[]>;
  doctor: (slug: string) => Promise<DoctorDto>;
  files: (slug: string) => Promise<ProjectOverviewDto>;
  /** The Agent tools cache: null when nothing was computed for the project yet. Never a run. */
  agentTools: (slug: string) => AgentToolsDto | null;
  connections: () => Promise<ConnectionsDto>;
  health: () => HealthDto;
  stopped: (slug: string) => Promise<boolean>;
  /** Sends that failed in the last 24 hours and sends stuck in "sending" (the Overview's own counts); absent: none. */
  sendTrouble?: (slug: string) => Promise<{ failed: number; stuck: number }>;
  /** The CLI detector's last answer (P57), null before the first one. */
  clis: () => readonly CliFactDto[] | null;
  /** The core update check's cached answer (P68), null when the server has none. */
  core: () => CoreUpdateDto | null;
  /** P78: the month of `llm_calls`, the cap and whether a key is there; absent: no LLM part. */
  llm?: () => Promise<LlmStanding>;
}

/** What the LLM part is judged from (P78): the ledger's month, the cap, the key's presence (never its value) and the fix lines of `@hub/llm`. */
export interface LlmStanding {
  month: LlmMonth;
  capMicroUsd: number;
  keyPresent: boolean;
  fake: boolean;
  noKeyFix: string;
  capFix: string;
}

const CLI_LABEL = { claude: "Claude Code", codex: "Codex" } as const;
const NOT_RUN = "Run the check on Settings ▸ Agent";

type Part = Omit<SchemeNode, "detail" | "fix"> & { detail?: string; fix?: string | null; /** What a healthy part may still say (P70: "16 of 16 checks pass"). */ okDetail?: string };
const node = ({ okDetail, ...p }: Part): SchemeNode => ({ ...p, detail: p.state === "ok" ? (okDetail ?? "") : (p.detail ?? ""), fix: p.state === "ok" ? null : (p.fix ?? null) });

/** The phrase that fixes a project's setup (P70: Overview shows a phrase as the fix of what a session fixes; P81: `phrase()`, English). */
export const setupFix = (slug: string): string => `Say “${phrase("project-setup", slug)}” in a session (project-setup)`;
/** "notion.access, knowledge, filters and 2 more": at most three names, then how many more. */
const names = (list: readonly string[]): string => list.slice(0, 3).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");

const ROW_STATE: Record<AgentToolRow["state"], SchemeState> = { pass: "ok", warn: "warn", fail: "fail", skip: "unknown" };
const worse = (a: SchemeState, b: SchemeState): SchemeState => (["fail", "warn", "unknown", "ok"].find((s) => s === a || s === b) as SchemeState);

/** The rows a part of its own covers (the CLIs are the detector's parts); every other row is the "Agent sessions" part. */
const OWN_PART = (id: string): boolean => id.startsWith("cli.") || ["mcp.present.mail-mcp", "mcp.answers.mail-mcp", "mcp.present.hub", "mcp.answers.hub", "guard.hook", "send-tools.off"].includes(id);

/** The connector an attached connector's own row is about (`connector.answers.gcal-hello` → `gcal-hello`), else null. */
const connectorOf = (id: string): string | null => /^connector\.(present|answers|account|tools-off)\.(.+)$/.exec(id)?.[2] ?? null;

const CONNECTOR_LABEL = { calendar: "Calendar", drive: "Drive" } as const;

/**
 * The Google connectors attached to the project (P62, P63 O5): one part each, labelled with its account (the hub name while the
 * account is not known), its standing the worst of its own rows. A connector whose account is not known is never "Works".
 * Nothing cached: no part (the attachment itself is only known from the Agent tools run).
 */
function connectorParts(slug: string, tools: AgentToolsDto | null): SchemeNode[] {
  return (tools?.capabilities ?? []).map((c) => {
    const r = fromRows(tools, (id) => connectorOf(id) === c.name);
    const state: SchemeState = !c.account && r.state === "ok" ? "unknown" : r.state;
    const detail = !c.account && r.state === "ok" ? "Its Google account is not known yet." : r.detail;
    return node({ id: `${slug}:${c.kind}:${c.name}`, kind: c.kind, project: slug, label: `${CONNECTOR_LABEL[c.kind]} · ${c.account ?? c.name}`.slice(0, 80), state, detail, fix: r.fix, place: "agent" });
  });
}

/**
 * Agent sessions (UX pass 2026-11-20): every Agent tools row no other part covers (the Notion connector, knowledge-mcp, the
 * session files, the skills, the mode, the send pipeline, the session log), so a row that puts a dot on Settings ▸ Agent is also a
 * "Needs you" item on Overview. The detail names the row, and how many more there are.
 */
function sessionPart(tools: AgentToolsDto | null): { state: SchemeState; detail: string; fix: string | null } {
  if (!tools) return { state: "unknown", detail: `Not checked yet. ${NOT_RUN}.`, fix: null };
  const connectors = new Set(tools.capabilities.map((c) => c.name));
  const rows = tools.rows.filter((r) => !OWN_PART(r.id) && !connectors.has(connectorOf(r.id) ?? ""));
  if (rows.length === 0) return { state: "unknown", detail: "No check covers it.", fix: null };
  const state = rows.map((r) => ROW_STATE[r.state]).reduce(worse);
  const bad = rows.filter((r) => ROW_STATE[r.state] === state);
  const first = bad[0];
  if (!first || state === "ok" || state === "unknown") return { state, detail: "", fix: null };
  // The same check failing in the other CLI is said in two words; any other check is counted.
  const also = bad.filter((r) => r.id === first.id && r.cli !== first.cli).map((r) => ` ${CLI_LABEL[r.cli]} too.`).join("");
  const others = new Set(bad.filter((r) => r.id !== first.id).map((r) => r.id)).size;
  const more = others > 0 ? ` And ${others} more ${others === 1 ? "check" : "checks"}.` : "";
  return { state, detail: `${CLI_LABEL[first.cli]}: ${first.detail}${also}${more}`, fix: first.fix };
}

/** The worst of a project's Agent tools rows whose id matches, over both CLIs; nothing cached or no such row is unknown. */
function fromRows(tools: AgentToolsDto | null, match: (id: string) => boolean): { state: SchemeState; detail: string; fix: string | null } {
  if (!tools) return { state: "unknown", detail: `Not checked yet. ${NOT_RUN}.`, fix: null };
  const rows = tools.rows.filter((r) => match(r.id));
  if (rows.length === 0) return { state: "unknown", detail: "No check covers it.", fix: null };
  const state = rows.map((r) => ROW_STATE[r.state]).reduce(worse);
  const bad = rows.find((r) => ROW_STATE[r.state] === state);
  return { state, detail: bad && state !== "ok" ? `${CLI_LABEL[bad.cli]}: ${bad.detail}` : "", fix: bad?.fix ?? null };
}

function tokenNode(c: ConnectionDto): SchemeNode {
  const k = c.check;
  const id = `${c.kind}:${c.id}`;
  // P71 M3: the Telegram bot's token is set on Messengers ▸ Settings, beside the accounts; the Notion token stays on Connections.
  const base = { id, kind: c.kind, project: null, label: c.identity ? `${c.label} (${c.identity})` : c.label, place: c.kind === "telegram" ? ("messengers" as const) : ("connections" as const) };
  if (c.secret.state === "missing") return node({ ...base, state: "fail", detail: "No key stored." });
  if (c.secret.state === "unsafe-mode" || c.secret.state === "malformed") return node({ ...base, state: "fail", detail: c.secret.state === "malformed" ? "The stored key is not a key." : "The key file is readable by others." });
  if (k.state === "fresh") return node({ ...base, state: "ok" });
  // A pass over an hour old is still a pass: its age is not something the owner must act on (UX pass 2026-11-20).
  if (k.state === "stale") return node({ ...base, state: "ok", okDetail: "Passed its last test over an hour ago." });
  if (k.state === "error") return node({ ...base, state: "fail", detail: k.message, fix: k.fix });
  return node({ ...base, state: "unknown", detail: "Not tested since the server started: Test it on Settings ▸ Connections." });
}

/**
 * P71: one part per Telegram user account (the owner's own account), from the health snapshot. A parked account is broken with its
 * fix line, so it is a "needs you" item; a passing error needs a look. The label names the account's id only, never a chat. Its
 * place is Messengers ▸ Settings (P71 M3), where the account is connected and disconnected.
 */
function telegramUserNodes(h: HealthDto): SchemeNode[] {
  return h.telegramUser.accounts.map((a) => {
    const state: SchemeState = a.state === "running" ? "ok" : a.state === "parked" ? "fail" : a.state === "error" ? "warn" : "unknown";
    const detail = a.state === "parked" ? `Parked (${a.parked ?? "unknown"}): it is not retried by itself.` : a.state === "error" ? (a.lastError ?? "The connection is failing; it retries.") : a.state === "stopped" ? "Stopped." : "Connecting.";
    return node({ id: `telegram:user:${a.account}`, kind: "telegram", project: null, label: `Telegram account ${a.account}`, state, detail, fix: a.fix, place: "messengers" });
  });
}

function cliNodes(clis: readonly CliFactDto[] | null): SchemeNode[] {
  if (!clis) return (["claude", "codex"] as const).map((cli) => node({ id: `cli:${cli}`, kind: "cli", project: null, label: CLI_LABEL[cli], state: "unknown", detail: `Not detected yet. ${NOT_RUN}.`, place: "agent" }));
  return clis.map((f) => {
    const label = f.version ? `${CLI_LABEL[f.cli]} ${f.version}`.slice(0, 80) : CLI_LABEL[f.cli];
    const state: SchemeState = f.state === "ready" ? "ok" : f.state === "unknown" ? "unknown" : f.state === "signed-out" ? "warn" : "fail";
    return node({ id: `cli:${f.cli}`, kind: "cli", project: null, label, state, detail: f.detail, fix: f.fix, place: "agent" });
  });
}

function coreNode(d: CoreUpdateDto | null): SchemeNode[] {
  if (!d) return [];
  const label = `Core ${d.pin ?? d.inUse ?? ""}`.trim();
  const state: SchemeState = d.level === "required" ? "fail" : d.level === "recommended" ? "warn" : d.level === "unknown" ? "unknown" : "ok";
  return [node({ id: "core", kind: "core", project: null, label, state, detail: d.reason, fix: d.command.length > 0 ? d.command.join("\n") : null, place: "mac" })];
}

const usd = (micro: number): string => `$${(micro / 1e6).toFixed(2)}`;
const calls = (n: number): string => `${n} ${n === 1 ? "call" : "calls"}`;

/**
 * P78 (decision 0039 point 4): the instance's model access. No part until a caller has used it this month (nothing wants it, so
 * nothing needs him). Broken, and so a "Needs you" item, when a call was refused for a missing key that is still missing, or
 * for the monthly cap that is still reached. The fix lines are `@hub/llm`'s own sentences; no pane sets the key or the cap yet.
 */
export function llmNode(s: LlmStanding): SchemeNode[] {
  const m = s.month;
  if (m.calls === 0 && m.refused.budget === 0 && m.refused.no_key === 0) return [];
  const spend = `${usd(m.costMicroUsd)} of ${usd(s.capMicroUsd)} this month (UTC)`;
  const base = { id: "llm", kind: "llm" as const, project: null, label: s.fake ? "LLM (fake)" : "LLM (OpenRouter)", place: null };
  const refusedLast = (m.lastRefusedAt ?? "") > (m.lastOkAt ?? "");
  if (!s.keyPresent && !s.fake && m.refused.no_key > 0 && refusedLast) {
    return [node({ ...base, state: "fail", detail: `No key: ${calls(m.refused.no_key)} refused this month, so callers say "not analysed".`, fix: s.noKeyFix })];
  }
  if (m.costMicroUsd >= s.capMicroUsd && m.refused.budget > 0) {
    return [node({ ...base, state: "fail", detail: `The monthly cap is reached: ${spend}; ${calls(m.refused.budget)} refused.`, fix: s.capFix })];
  }
  return [node({ ...base, state: "ok", okDetail: `${spend}, ${calls(m.calls)}` })];
}

async function projectNodes(slug: string, s: SchemeSources, mail: ConnectionsDto | null): Promise<SchemeNode[]> {
  const [doctor, files, stopped, trouble] = await Promise.all([s.doctor(slug), s.files(slug), s.stopped(slug), s.sendTrouble?.(slug) ?? { failed: 0, stuck: 0 }]);
  const tools = s.agentTools(slug);
  const p = (kind: SchemeNode["kind"], key: string) => ({ id: `${slug}:${key}`, kind, project: slug });
  const out: SchemeNode[] = [];

  for (const account of doctor.facts?.accounts ?? []) {
    const row = mail?.mail.find((m) => m.account.toLowerCase() === account.toLowerCase());
    const found = row?.foundInMail ?? null;
    const why = mail?.mailRead.state === "not-running" ? "Apple Mail is not running." : "Apple Mail did not answer in time.";
    out.push(node({ ...p("mailbox", `mailbox:${account.toLowerCase()}`), label: account.slice(0, 80), state: found === null ? "unknown" : found ? "ok" : "fail", detail: found === false ? "Not an account in Apple Mail." : why, fix: mail?.mailRead.fix ?? null, place: "mail" }));
  }
  out.push(node({ ...p("mail-mcp", "mail-mcp"), label: "mail-mcp", ...fromRows(tools, (id) => id === "mcp.present.mail-mcp" || id === "mcp.answers.mail-mcp"), place: "agent" }));
  out.push(node({ ...p("hub-tools", "hub-tools"), label: "Hub tools", ...fromRows(tools, (id) => id === "mcp.present.hub" || id === "mcp.answers.hub"), place: "agent" }));
  out.push(node({ ...p("guard", "guard"), label: "Guard", ...fromRows(tools, (id) => id === "guard.hook" || id === "send-tools.off"), place: "agent" }));
  out.push(node({ ...p("session", "session"), label: "Agent sessions", ...sessionPart(tools), place: "agent" }));
  out.push(...connectorParts(slug, tools));

  const k = files.knowledge;
  const knowledge = k.state === "absent" ? { state: "unknown" as const, detail: "No knowledge yet." } : k.state === "error" ? { state: "fail" as const, detail: k.message } : !k.consistent ? { state: "fail" as const, detail: `${k.problems} file problems.` } : k.expired > 0 ? { state: "warn" as const, detail: `${k.expired} expired.` } : { state: "ok" as const };
  out.push(node({ ...p("knowledge", "knowledge"), label: k.state === "ok" ? `Knowledge base (${k.indexed} entries)` : "Knowledge base", ...knowledge, place: "knowledge" }));

  const f = files.filters;
  const filters = f.state === "absent" ? { state: "unknown" as const, detail: "No mail filters yet." } : f.state === "error" ? { state: "fail" as const, detail: f.message } : f.issues.length > 0 ? { state: "warn" as const, detail: f.issues.join("; ") } : { state: "ok" as const };
  out.push(node({ ...p("mail-filters", "mail-filters"), label: f.state === "ok" ? `Mail filters (${f.rules} rules)` : "Mail filters", ...filters, place: "mail" }));

  const checks = doctor.checks;
  const notion = checks.filter((c) => c.name.startsWith("notion"));
  const failed = checks.filter((c) => c.outcome === "fail" && !c.name.startsWith("notion"));
  const run = checks.filter((c) => c.outcome !== "skipped");
  // P70: a failing check is named with its own detail (the first one) and the phrase that fixes it; test mode is Sending's, not setup's.
  const first = failed[0];
  const setup =
    doctor.state === "absent" ? { state: "fail" as const, detail: "No project.md yet.", fix: setupFix(slug) }
    : first ? { state: "fail" as const, detail: `Failing: ${names(failed.map((c) => c.name))}. ${first.name}: ${first.detail}`, fix: setupFix(slug) }
    : doctor.facts?.status === "draft" ? { state: "warn" as const, detail: "The project is still a draft.", fix: setupFix(slug) }
    : run.length === 0 ? { state: "unknown" as const, detail: "No check ran here." }
    : { state: "ok" as const, okDetail: `${run.length - run.filter((c) => c.outcome === "warn").length} of ${run.length} checks pass` };
  out.push(node({ ...p("setup", "setup"), label: "Project setup", ...setup, place: "overview" }));
  const nState: SchemeState = notion.some((c) => c.outcome === "fail") ? "fail" : notion.some((c) => c.outcome === "warn") ? "warn" : notion.length > 0 && notion.every((c) => c.outcome === "pass") ? "ok" : "unknown";
  const nBad = notion.find((c) => c.outcome === "fail" || c.outcome === "warn");
  out.push(node({ ...p("notion-db", "notion-db"), label: "Notion databases", state: nState, detail: nBad?.detail ?? "Checked by the agent in a session (hub project doctor).", place: "overview" }));

  const h = s.health();
  const sent = h.sent.state;
  const door =
    stopped ? { state: "warn" as const, detail: "Sending is stopped." }
    : sent === "error" ? { state: "fail" as const, detail: h.sent.lastError ?? "Sent detection is failing." }
    // The send-failed and sending-stuck facts put a dot on Settings ▸ Sending, so they are items here too (UX pass 2026-11-20).
    : trouble.stuck > 0 ? { state: "warn" as const, detail: `${trouble.stuck === 1 ? "1 send is" : `${trouble.stuck} sends are`} stuck in "sending": check Mail's Sent folder.` }
    : trouble.failed > 0 ? { state: "warn" as const, detail: `${trouble.failed === 1 ? "1 send" : `${trouble.failed} sends`} failed in the last 24 hours: see Activity ▸ Sends.` }
    : h.mailer === "fake" ? { state: "warn" as const, detail: "Sends are fake (demo mode)." }
    : { state: "ok" as const };
  out.push(node({ ...p("send-door", "send-door"), label: "Send door", ...door, place: "sending" }));
  return out;
}

export async function composeScheme(s: SchemeSources): Promise<SchemeDto> {
  const [slugs, conn] = await Promise.all([s.projects(), s.connections().catch(() => null)]);
  const tokens = (conn?.connections ?? []).filter((c) => c.kind === "notion" || c.secret.state !== "missing");
  const llm = s.llm ? llmNode(await s.llm()) : [];
  const instance = [...coreNode(s.core()), ...cliNodes(s.clis()), ...tokens.map(tokenNode), ...telegramUserNodes(s.health()), ...llm];
  const perProject = (await Promise.all(slugs.map((slug) => projectNodes(slug, s, conn)))).flat();
  const nodes = [...instance, ...perProject];
  return schemeDto.parse({ nodes });
}
