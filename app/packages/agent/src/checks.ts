import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { codexSessionPaths, type AgentCli, type HubPaths } from "@hub/config/paths";
import { codexConfigBypasses, codexHome, CODEX_PROFILE } from "./codex";
import { DENIED_TOOLS, DRAFT_TOOLS, HUB_MCP_SERVERS, SEND_LIKE_TOOL } from "./deny";
import { CLI_LABELS, MEASURED_VERSIONS } from "./session";

// "Agent tools" (P49 section 5B): per CLI and per project, whether a hub agent session has what it needs, loaded and
// correct. One source for `hub doctor --only Agent` and the Connections block: the server and the doctor call this.
// Every row that is not a pass names one command line that fixes it. Read only: nothing here writes or sends.

export type AgentCheckState = "pass" | "warn" | "fail" | "skip";
export interface AgentCheckRow { id: string; cli: AgentCli; title: string; state: AgentCheckState; detail: string; fix: string | null }

export interface RunOutput { code: number; stdout: string; stderr: string }
export interface McpAnswer { ok: boolean; tools: string[]; detail: string }

/** What the checks reach outside the files: a CLI, an MCP server. Tests pass a fake. */
export interface AgentProbe {
  run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<RunOutput>;
  /** initialize, then tools/list, against one server spec of the session's MCP config. */
  mcp(name: string, spec: Record<string, unknown>): Promise<McpAnswer>;
}

export interface AgentCheckInput {
  paths: HubPaths;
  slug: string;
  cli: AgentCli;
  unattended: boolean;
  probe: AgentProbe;
}

const json = (p: string): Record<string, any> | null => {
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, any>; } catch { return null; }
};
const text = (p: string): string | null => {
  try { return readFileSync(p, "utf8"); } catch { return null; }
};

/** `hub agent <slug> --prepare` for Claude; Codex needs its own home, so `--cli codex`. */
export const prepareLine = (slug: string, cli: AgentCli): string => `hub agent ${slug}${cli === "codex" ? " --cli codex" : ""} --prepare`;

export async function agentChecks(i: AgentCheckInput): Promise<AgentCheckRow[]> {
  const { paths, slug, cli, probe } = i;
  const rows: AgentCheckRow[] = [];
  const row = (id: string, title: string, state: AgentCheckState, detail: string, fix: string | null = null) => rows.push({ id, cli, title, state, detail, fix: state === "pass" || state === "skip" ? null : fix });
  const prepare = prepareLine(slug, cli);
  const label = CLI_LABELS[cli];
  const sessionDir = path.join(paths.stateProjects, slug);
  const cHome = codexHome(paths, slug);
  const codexEnv = { ...process.env, CODEX_HOME: cHome };

  // 1. The CLI and its version (the sandbox flags were measured on one version each).
  const v = await probe.run(cli, ["--version"]).catch(() => ({ code: 127, stdout: "", stderr: "" }));
  const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null;
  if (v.code !== 0 || !version) row("cli.version", `${label} installed`, "fail", `${cli} not found on PATH`, cli === "claude" ? "npm i -g @anthropic-ai/claude-code" : "npm i -g @openai/codex");
  else if (version !== MEASURED_VERSIONS[cli]) row("cli.version", `${label} installed`, "warn", `${version}; the sandbox was measured on ${MEASURED_VERSIONS[cli]}: rerun the unattended checks of @docs/core/24-terminal.md`, `${cli} --version`);
  else row("cli.version", `${label} installed`, "pass", version);
  const installed = v.code === 0 && !!version;

  // 2. Signed in. Claude signs in on its first start; Codex keeps auth.json, linked into the session's own home.
  if (cli === "claude") row("cli.signed-in", "Signed in", "skip", "Claude Code asks on its first start");
  else if (!installed) row("cli.signed-in", "Signed in", "skip", "Codex is not installed");
  else {
    const s = await probe.run("codex", ["login", "status"], codexEnv).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    if (s.code === 0) row("cli.signed-in", "Signed in", "pass", (s.stdout || s.stderr).trim().split("\n")[0] || "signed in");
    else row("cli.signed-in", "Signed in", "fail", "codex login status: not signed in (the session links your auth.json)", `codex login && ${prepare}`);
  }

  // 3. The generated session files.
  const settings = json(path.join(sessionDir, "settings.json"));
  const mcp = json(path.join(sessionDir, "mcp.json"));
  const toml = cli === "codex" ? text(path.join(cHome, "config.toml")) : null;
  const section = (n: string): string => {
    const lines = (toml ?? "").split("\n");
    const at = lines.findIndex((l) => l.trim() === `[mcp_servers."${n}"]` || l.trim() === `[mcp_servers.${n}]`);
    if (at < 0) return "";
    const end = lines.findIndex((l, k) => k > at && l.startsWith("["));
    return lines.slice(at, end < 0 ? undefined : end).join("\n");
  };
  const filesOk = !!settings && !!mcp && (cli === "claude" || !!toml);
  row("session.files", "Session files written", filesOk ? "pass" : "fail", filesOk ? (cli === "codex" ? cHome : sessionDir) : "no session files for this project yet", prepare);

  // 4. MCP servers: present in the session's config, and answering.
  const servers = (mcp?.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
  const listed: Array<{ name: string; tools: string[] }> = [];
  for (const name of HUB_MCP_SERVERS) {
    const spec = servers[name];
    const inCodex = toml === null || section(name) !== "";
    if (!spec) { row(`mcp.present.${name}`, `${name} configured`, "skip", "not in the instance's MCP config"); continue; }
    row(`mcp.present.${name}`, `${name} configured`, inCodex ? "pass" : "fail", inCodex ? String(spec.type ?? "stdio") : "missing from the Codex config", prepare);
    const a = await probe.mcp(name, spec).catch((e: Error) => ({ ok: false, tools: [], detail: e.message }));
    if (a.ok) { listed.push({ name, tools: a.tools }); row(`mcp.answers.${name}`, `${name} answers`, "pass", `${a.tools.length} tools`); }
    else if (name === "notion") row(`mcp.answers.${name}`, `${name} answers`, "warn", `${a.detail} (a remote server: sign in once per session home)`, cli === "codex" ? `CODEX_HOME=${cHome} codex mcp login notion` : "claude /mcp");
    else row(`mcp.answers.${name}`, `${name} answers`, "fail", a.detail, "hub doctor --only MCP");
  }

  // 5. No tool that sends, forwards or removes reaches the session.
  const denied = new Set(DENIED_TOOLS);
  const open = listed.flatMap((l) => l.tools.filter((t) => SEND_LIKE_TOOL.test(t) && !DRAFT_TOOLS.includes(t) && !denied.has(`mcp__${l.name}__${t}`)).map((t) => `${l.name}.${t}`));
  const codexOff = toml === null || HUB_MCP_SERVERS.every((n) => !servers[n] || !DENIED_TOOLS.some((t) => t.startsWith(`mcp__${n}__`)) || /^disabled_tools = /m.test(section(n)));
  if (!listed.length) row("send-tools.off", "Send tools off", "skip", "no server answered");
  else if (open.length) row("send-tools.off", "Send tools off", "fail", `not denied: ${open.join(", ")}`, "hub core update");
  else if (!codexOff) row("send-tools.off", "Send tools off", "fail", "the Codex config does not disable the send tools", prepare);
  else row("send-tools.off", "Send tools off", "pass", `${DENIED_TOOLS.length} denied`);

  // 6. Skills linked where the CLI looks.
  const skillsDir = cli === "claude" ? paths.claudeSkills : codexSessionPaths(paths, slug).skills;
  const linked = existsSync(skillsDir) ? readdirSync(skillsDir).length : 0;
  row("skills.linked", "Skills linked", linked ? "pass" : "fail", linked ? `${linked} in ${skillsDir}` : `none in ${skillsDir}`, prepare);

  // 7. The mode: prompts on, or the OS sandbox with no network and no bypass.
  if (cli === "claude") {
    const sb = settings?.sandbox as Record<string, any> | undefined;
    const good = !!sb && sb.enabled === true && sb.allowUnsandboxedCommands === false && Array.isArray(sb.network?.allowedDomains) && sb.network.allowedDomains.length === 0;
    if (!i.unattended) row("mode", "Mode", settings ? "pass" : "fail", "attended: Claude Code asks before each action", prepare);
    else row("mode", "Mode", good ? "pass" : "fail", good ? "unattended: OS sandbox on, no network, no unsandboxed commands" : "unattended without the OS sandbox block", prepare);
  } else if (toml === null) row("mode", "Mode", "fail", "no Codex config", prepare);
  else if (codexConfigBypasses(toml)) row("mode", "Mode", "fail", "the Codex config bypasses the sandbox", prepare);
  else {
    const profile = toml.includes(`default_permissions = "${CODEX_PROFILE}"`) && /\[permissions\.hub\.network\]\s*\nenabled = false/.test(toml);
    const approval = toml.includes(`approval_policy = "${i.unattended ? "never" : "on-request"}"`);
    row("mode", "Mode", profile && approval ? "pass" : "fail", profile && approval ? `${i.unattended ? "unattended" : "attended"}: the hub profile, no network` : "the Codex config does not use the hub profile for this mode", prepare);
  }

  // 8. The send pipeline: the policy file is the server's, not the project's.
  const pol = json(path.join(paths.stateProjects, slug, "send-policy.json"));
  if (!existsSync(path.join(paths.stateProjects, slug, "send-policy.json"))) row("send.pipeline", "Send pipeline", "pass", "no policy file: drafts only, test recipients");
  else if (!pol || pol.schema !== 1) row("send.pipeline", "Send pipeline", "fail", "send-policy.json does not parse", `hub send policy ${slug}`);
  else row("send.pipeline", "Send pipeline", "pass", `${pol.mode}, recipients ${Array.isArray(pol.recipients) ? pol.recipients.length + " listed" : pol.recipients}`);

  // 9. The guard hook (Claude only; Codex has the rules file and the sandbox).
  if (cli === "codex") row("guard.hook", "Guard hook", "skip", "Codex has no hook: the forbidden-command rules and the sandbox hold");
  else {
    const pre = JSON.stringify(settings?.hooks?.PreToolUse ?? "");
    row("guard.hook", "Guard hook", pre.includes(" guard") ? "pass" : "fail", pre.includes(" guard") ? "PreToolUse runs hub guard" : "no guard hook in the session settings", prepare);
  }
  return rows;
}

/** The real probe: CLIs on PATH, MCP over stdio (one JSON line each way) or streamable HTTP. 10 s per server. */
export function defaultProbe(o: { timeoutMs?: number; fetch?: typeof fetch } = {}): AgentProbe {
  const ms = o.timeoutMs ?? 10_000;
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hub-agent-tools", version: "0" } } };
  const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const names = (r: any): string[] => ((r?.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
  return {
    run: (cmd, args, env) => new Promise((resolve) => {
      const c = spawn(cmd, args, { env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const t = setTimeout(() => c.kill("SIGKILL"), ms);
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (err += d));
      c.on("error", () => { clearTimeout(t); resolve({ code: 127, stdout: "", stderr: "" }); });
      c.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, stdout: out, stderr: err }); });
    }),
    async mcp(_name, spec) {
      if (spec.url) {
        const f = o.fetch ?? fetch;
        const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
        const post = async (body: unknown, sid?: string | null) => {
          const r = await f(String(spec.url), { method: "POST", headers: { ...H, ...(sid ? { "mcp-session-id": sid } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
          const t = await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const line = t.split("\n").find((l) => l.startsWith("data:"));
          return { sid: r.headers.get("mcp-session-id"), body: t ? JSON.parse(line ? line.slice(5) : t) : null };
        };
        try {
          const a = await post(init);
          await post({ jsonrpc: "2.0", method: "notifications/initialized" }, a.sid).catch(() => null);
          const tools = names((await post(list, a.sid)).body);
          return { ok: true, tools, detail: `${tools.length} tools` };
        } catch (e) {
          return { ok: false, tools: [], detail: (e as Error).message };
        }
      }
      return new Promise<McpAnswer>((resolve) => {
        const c = spawn(String(spec.command), Array.isArray(spec.args) ? spec.args.map(String) : [], { env: { ...process.env, ...((spec.env as Record<string, string>) ?? {}) }, stdio: ["pipe", "pipe", "ignore"] });
        let buf = "";
        const done = (a: McpAnswer) => { clearTimeout(t); c.kill(); resolve(a); };
        const t = setTimeout(() => done({ ok: false, tools: [], detail: `no answer in ${ms / 1000} s` }), ms);
        c.on("error", (e) => done({ ok: false, tools: [], detail: e.message }));
        c.stdout.on("data", (d) => {
          buf += d;
          for (const l of buf.split("\n").slice(0, -1)) {
            let m: any;
            try { m = JSON.parse(l); } catch { continue; }
            if (m.id === 1) { c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" + JSON.stringify(list) + "\n"); }
            if (m.id === 2) { const tools = names(m); done({ ok: true, tools, detail: `${tools.length} tools` }); }
          }
          buf = buf.slice(buf.lastIndexOf("\n") + 1);
        });
        c.stdin.write(JSON.stringify(init) + "\n");
      });
    },
  };
}

/** `HUB_AGENT_TOOLS=fake` (e2e only, refused without HUB_DB): fixed rows, one of each state, nothing probed. */
export function fakeAgentRows(slug: string, cli: AgentCli): AgentCheckRow[] {
  const r = (id: string, title: string, state: AgentCheckState, detail: string, fix: string | null = null): AgentCheckRow => ({ id, cli, title, state, detail, fix });
  return [
    r("cli.version", `${CLI_LABELS[cli]} installed`, "pass", MEASURED_VERSIONS[cli]),
    r("cli.signed-in", "Signed in", cli === "claude" ? "skip" : "pass", cli === "claude" ? "Claude Code asks on its first start" : "Logged in"),
    r("session.files", "Session files written", "fail", "no session files for this project yet", prepareLine(slug, cli)),
    r("mcp.answers.notion", "notion answers", "warn", "HTTP 401 (a remote server: sign in once per session home)", cli === "codex" ? "codex mcp login notion" : "claude /mcp"),
    r("send-tools.off", "Send tools off", "pass", `${DENIED_TOOLS.length} denied`),
  ];
}
