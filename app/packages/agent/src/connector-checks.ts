import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";
import { phrase } from "@hub/contract/help";
import { projectStore } from "@hub/projects";
import { connectorDeniedTools, instanceConnectors, KINDS, readConnectorAccounts, resolveConnectors, type AttachedConnector } from "./connectors";

// P62 K2: the connector rows of Agent tools (Settings ▸ Agent, `hub doctor --only Agent`). Read only. A row that needs the owner
// names what to do; an attached-to-nothing connector and the claude.ai connectors are info (skip), folded with the green rows.

type State = "pass" | "warn" | "fail" | "skip";
export interface ConnectorRow { id: string; title: string; state: State; detail: string; fix: string | null }
export interface ConnectorCheckInput {
  paths: HubPaths;
  slug: string;
  cli: AgentCli;
  /** The session's generated files, as `agentChecks` read them. */
  mcpServers: Record<string, Record<string, unknown>>;
  deny: readonly string[];
  /** initialize + tools/list against one server spec (the Agent tools probe). */
  answer: (name: string, spec: Record<string, unknown>) => Promise<{ ok: boolean; tools: string[]; detail: string }>;
  /** `~/.claude.json` (the owner's claude.ai connectors); default from HOME. */
  claudeJson?: string;
}

/** The phrase that changes which connectors a project lists (project-setup asks once per project; P81: the one English phrase, shown on Overview). */
export const setupPhrase = (slug: string): string => phrase("project-setup", slug);
export const addLine = (kind: string, name: string): string => `hub connectors add ${kind} ${name} --client-id <OAuth client id> --account <address>`;

/** Every connector name some project of the instance lists. */
function listedAnywhere(paths: HubPaths): Set<string> {
  const out = new Set<string>();
  if (!existsSync(paths.projects)) return out;
  for (const e of readdirSync(paths.projects, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    try {
      const c = projectStore({ projects: paths.projects }).config(e.name);
      for (const n of [...c.calendar.connector, ...c.drive.connector]) out.add(n);
    } catch { /* a project that does not load lists nothing */ }
  }
  return out;
}

/** The Google services connected in the owner's claude.ai account (names only; `~/.claude.json` keeps no spec). */
export function claudeAiGoogle(file: string): string[] {
  try {
    const list = (JSON.parse(readFileSync(file, "utf8")) as { claudeAiMcpEverConnected?: unknown }).claudeAiMcpEverConnected;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && /Google|Gmail/.test(x)).map((x) => x.replace(/^claude\.ai /, "")) : [];
  } catch { return []; }
}

export async function connectorRows(i: ConnectorCheckInput): Promise<ConnectorRow[]> {
  const rows: ConnectorRow[] = [];
  const row = (id: string, title: string, state: State, detail: string, fix: string | null = null) => rows.push({ id, title, state, detail, fix: state === "pass" || state === "skip" ? null : fix });
  let attached: AttachedConnector[] = [];
  try {
    const r = resolveConnectors(i.paths, projectStore({ projects: i.paths.projects }).config(i.slug));
    attached = r.attached;
    for (const p of r.problems) row(`connector.attach.${p.name}`, `${p.name} attached`, "fail", `listed in project.md, not used: ${p.why}`, p.why.startsWith("not in") ? addLine(p.kind, p.name) : setupPhrase(i.slug));
  } catch { return rows; }
  const prepare = `hub agent ${i.slug} --prepare`;
  for (const c of attached) {
    const label = KINDS[c.kind].label;
    if (i.cli === "codex") {
      row(`connector.codex.${c.name}`, `${c.name} (${label})`, "skip", "Claude Code sessions only: Codex cannot sign in to Google's servers (no OAuth client id)");
      continue;
    }
    const inFile = !!i.mcpServers[c.name];
    row(`connector.present.${c.name}`, `${c.name} configured`, inFile ? "pass" : "fail", inFile ? `${label}, in the session's MCP file` : "not in the session's MCP file yet", prepare);
    const a = await i.answer(c.name, c.spec).catch((e: Error) => ({ ok: false, tools: [] as string[], detail: e.message }));
    // The hub holds no Google login: an unauthorised answer is Google's endpoint answering; the session signs in itself.
    if (a.ok || /HTTP 40[13]/.test(a.detail)) row(`connector.answers.${c.name}`, `${c.name} answers`, "pass", a.ok ? `${a.tools.length} tools` : "Google answers; each project's session signs in once (/mcp)");
    else row(`connector.answers.${c.name}`, `${c.name} answers`, "fail", a.detail, "hub doctor --only Agent");
    if (!c.account) row(`connector.account.${c.name}`, `${c.name} account`, "warn", c.kind === "calendar" ? `Not signed in yet, or not read. Type the line below in this project's Claude Code session, sign in to ${c.name} with the Google account it is for, then ask for this week's calendar.` : `Not known. Sign in with the line below in this project's Claude Code session, then state the account: hub connectors account ${c.name} <address>.`, "/mcp");
    else row(`connector.account.${c.name}`, `${c.name} account`, "pass", `${c.account.account}, ${c.account.how === "session" ? "read by a session" : "stated by you"} ${c.account.at.slice(0, 10)}; attached to ${i.slug}`);
    const want = connectorDeniedTools([c]);
    const missing = want.filter((t) => !i.deny.includes(t));
    const open = a.tools.filter((t) => !KINDS[c.kind].allowed.includes(t) && !i.deny.includes(`mcp__${c.name}__${t}`));
    if (missing.length || open.length) row(`connector.tools-off.${c.name}`, `${c.name} writes off`, "fail", `not denied: ${[...missing.map((t) => t.split("__").pop()), ...open].join(", ")}`, prepare);
    else row(`connector.tools-off.${c.name}`, `${c.name} writes off`, "pass", `${want.length} denied; ${KINDS[c.kind].holds.length ? "holds with no guests only" : "read only"}`);
  }
  if (i.cli === "claude") {
    const listed = listedAnywhere(i.paths);
    const accounts = readConnectorAccounts(i.paths);
    for (const c of instanceConnectors(i.paths).filter((x) => !listed.has(x.name))) {
      row(`connector.unattached.${c.name}`, `${c.name} (${KINDS[c.kind].label})`, "skip", `${accounts[c.name]?.account ?? "account not known"}: attached to no project, used by no session`);
    }
    const ai = claudeAiGoogle(i.claudeJson ?? path.join(process.env.HOME ?? "", ".claude.json"));
    if (ai.length) row("connector.claude-ai", "Claude account connectors", "skip", `${ai.join(", ")}: connected in your Claude account; they work in Claude Desktop and your own claude, never in a hub session`);
  }
  return rows;
}
