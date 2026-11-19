import type { AgentToolRow, AgentToolsDto } from "@hub/contract/agent-tools";
import type { ConnectionsDto, ConnectionDto } from "@hub/contract/connections";
import type { HealthDto } from "@hub/contract/health";
import type { CoreUpdateDto } from "@hub/contract/instance";
import type { DoctorDto, ProjectOverviewDto } from "@hub/contract/responses";
import { schemeDto, type SchemeDto, type SchemeEdge, type SchemeNode, type SchemeState } from "@hub/contract/scheme";
import type { CliFactDto } from "@hub/contract/terminal";

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
  /** The CLI detector's last answer (P57), null before the first one. */
  clis: () => readonly CliFactDto[] | null;
  /** The core update check's cached answer (P68), null when the server has none. */
  core: () => CoreUpdateDto | null;
}

const CLI_LABEL = { claude: "Claude Code", codex: "Codex" } as const;
const NOT_RUN = "Run the check on Settings ▸ Agent";

type Part = Omit<SchemeNode, "detail" | "fix"> & { detail?: string; fix?: string | null };
const node = (p: Part): SchemeNode => ({ ...p, detail: p.state === "ok" ? "" : (p.detail ?? ""), fix: p.state === "ok" ? null : (p.fix ?? null) });

const ROW_STATE: Record<AgentToolRow["state"], SchemeState> = { pass: "ok", warn: "warn", fail: "fail", skip: "unknown" };
const worse = (a: SchemeState, b: SchemeState): SchemeState => (["fail", "warn", "unknown", "ok"].find((s) => s === a || s === b) as SchemeState);

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
  const base = { id, kind: c.kind, project: null, label: c.identity ? `${c.label} (${c.identity})` : c.label, place: "connections" as const };
  if (c.secret.state === "missing") return node({ ...base, state: "fail", detail: "No key stored." });
  if (c.secret.state === "unsafe-mode" || c.secret.state === "malformed") return node({ ...base, state: "fail", detail: c.secret.state === "malformed" ? "The stored key is not a key." : "The key file is readable by others." });
  if (k.state === "fresh") return node({ ...base, state: "ok" });
  if (k.state === "stale") return node({ ...base, state: "warn", detail: "Last tested over an hour ago: Test it on Settings ▸ Connections." });
  if (k.state === "error") return node({ ...base, state: "fail", detail: k.message, fix: k.fix });
  return node({ ...base, state: "unknown", detail: "Not tested since the server started: Test it on Settings ▸ Connections." });
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

async function projectNodes(slug: string, s: SchemeSources, mail: ConnectionsDto | null): Promise<SchemeNode[]> {
  const [doctor, files, stopped] = await Promise.all([s.doctor(slug), s.files(slug), s.stopped(slug)]);
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
  const setup =
    doctor.state === "absent" ? { state: "fail" as const, detail: "No project.md yet." }
    : failed.length > 0 ? { state: "fail" as const, detail: `Failing: ${failed.map((c) => c.name).join(", ")}.` }
    : doctor.facts?.status === "draft" ? { state: "warn" as const, detail: "The project is still a draft." }
    : doctor.facts?.recipients === "test" ? { state: "warn" as const, detail: "Drafts go to the test list only." }
    : run.length === 0 ? { state: "unknown" as const, detail: "No check ran here." }
    : { state: "ok" as const };
  out.push(node({ ...p("setup", "setup"), label: "Project setup", ...setup, place: "overview" }));
  const nState: SchemeState = notion.some((c) => c.outcome === "fail") ? "fail" : notion.some((c) => c.outcome === "warn") ? "warn" : notion.length > 0 && notion.every((c) => c.outcome === "pass") ? "ok" : "unknown";
  const nBad = notion.find((c) => c.outcome === "fail" || c.outcome === "warn");
  out.push(node({ ...p("notion-db", "notion-db"), label: "Notion databases", state: nState, detail: nBad?.detail ?? "Checked by the agent in a session (hub project doctor).", place: "overview" }));

  const h = s.health();
  const sent = h.sent.state;
  const door =
    stopped ? { state: "warn" as const, detail: "Sending is stopped." }
    : sent === "error" ? { state: "fail" as const, detail: h.sent.lastError ?? "Sent detection is failing." }
    : h.mailer === "fake" ? { state: "warn" as const, detail: "Sends are fake (demo mode)." }
    : { state: "ok" as const };
  out.push(node({ ...p("send-door", "send-door"), label: "Send door", ...door, place: "sending" }));
  return out;
}

/** The fixed wiring (plan 4a): client mail reaches the mailbox, the agent reads it through mail-mcp, writes through the Hub tools, and the send door sends. */
function edgesOf(nodes: readonly SchemeNode[]): SchemeEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out: SchemeEdge[] = [];
  const add = (from: string, to: string, kind: SchemeEdge["kind"] = "flow") => ids.has(from) && ids.has(to) && out.push({ from, to, kind });
  const clis = nodes.filter((n) => n.kind === "cli").map((n) => n.id);
  for (const slug of new Set(nodes.flatMap((n) => (n.project ? [n.project] : [])))) {
    const of = (key: string) => `${slug}:${key}`;
    const boxes = nodes.filter((n) => n.project === slug && n.kind === "mailbox").map((n) => n.id);
    for (const b of boxes) add(b, of("mail-mcp"));
    for (const c of clis) {
      add(of("mail-mcp"), c);
      add(c, of("hub-tools"));
      add(c, of("knowledge"));
      add(c, of("notion-db"));
      add(of("guard"), c, "limits");
    }
    add(of("hub-tools"), of("send-door"));
    for (const b of boxes) add(of("send-door"), b);
  }
  for (const t of nodes.filter((n) => n.kind === "telegram")) for (const c of clis) add(t.id, c);
  return out;
}

export async function composeScheme(s: SchemeSources): Promise<SchemeDto> {
  const [slugs, conn] = await Promise.all([s.projects(), s.connections().catch(() => null)]);
  const tokens = (conn?.connections ?? []).filter((c) => c.kind === "notion" || c.secret.state !== "missing");
  const instance = [...coreNode(s.core()), ...cliNodes(s.clis()), ...tokens.map(tokenNode)];
  const perProject = (await Promise.all(slugs.map((slug) => projectNodes(slug, s, conn)))).flat();
  const nodes = [...instance, ...perProject];
  return schemeDto.parse({ nodes, edges: edgesOf(nodes) });
}
