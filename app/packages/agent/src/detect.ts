import { spawn } from "node:child_process";
import type { AgentCli } from "@hub/config/paths";
import type { CliFactDto, CliState, TerminalPreset } from "@hub/contract/terminal";
import { CLI_LABELS } from "./session";

// Which agent CLIs this Mac can start right now (P57): path, version and sign-in of Claude Code and Codex, read in ONE
// spawn of the owner's login shell, the environment a terminal tab gets (`$SHELL -l -i`). The non-login PATH can name
// another binary (measured 2026-11-19: a broken `codex` under nvm v22.11.0, a working one under v22.22.0), so the
// detector never asks the caller's PATH. Read only: `--version`, `claude auth status`, `codex login status`.

/** What a fact carries; the path stays on the server (the wire shape, `cliFactDto`, has none). */
export interface CliFact extends CliFactDto { path: string | null }

/** The one install line per CLI: the launcher, the Agent tools rows and the dock say the same. */
export const INSTALL_LINE: Record<AgentCli, string> = { claude: "npm i -g @anthropic-ai/claude-code", codex: "npm i -g @openai/codex" };
/** The one sign-in line per CLI (both read-only checks were measured: `claude auth status`, `codex login status`). */
export const LOGIN_LINE: Record<AgentCli, string> = { claude: "claude auth login", codex: "codex login" };

const CLIS: readonly AgentCli[] = ["claude", "codex"];

/**
 * The script the login shell runs. Each probe is fenced by marker lines, so whatever a profile prints (nvm, `no job
 * control`, a banner) is ignored. stdin is closed for every probe: nothing can wait on a prompt.
 */
export const DETECT_SCRIPT = [
  `hub_probe() { k=$1; shift; printf '\\n__HUB_BEGIN__ %s\\n' "$k"; "$@" </dev/null 2>&1; c=$?; printf '\\n__HUB_END__ %s %s\\n' "$k" "$c"; }`,
  `for c in claude codex; do`,
  `  p=$(command -v "$c" 2>/dev/null)`,
  `  printf '\\n__HUB_BEGIN__ %s.path\\n%s\\n__HUB_END__ %s.path 0\\n' "$c" "$p" "$c"`,
  `  [ -n "$p" ] && hub_probe "$c.version" "$p" --version`,
  `done`,
  `[ -n "$(command -v claude 2>/dev/null)" ] && hub_probe claude.auth claude auth status --json`,
  `[ -n "$(command -v codex 2>/dev/null)" ] && hub_probe codex.auth codex login status`,
  `exit 0`,
].join("\n");

export interface ProbeOut { out: string; code: number }

/** The fenced sections of the script's output, by key (`claude.path`, `codex.auth`, ...). Anything outside a fence is dropped. */
export function parseDetect(stdout: string): Map<string, ProbeOut> {
  const found = new Map<string, ProbeOut>();
  const re = /__HUB_BEGIN__ (\S+)\n([\s\S]*?)\n__HUB_END__ (\S+) (\d+)/g;
  for (const m of stdout.replace(/\r\n/g, "\n").matchAll(re)) {
    const [, key, out, end, code] = m;
    if (key && key === end) found.set(key, { out: (out ?? "").trim(), code: Number(code) });
  }
  return found;
}

const firstLine = (s: string): string => s.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) ?? "";

/** Claude's `auth status --json`: signed in, the method, or null when the output is not that JSON. */
function claudeAuth(out: string): { loggedIn: boolean; method: string | null } | null {
  const at = out.indexOf("{");
  if (at < 0) return null;
  try {
    const j: unknown = JSON.parse(out.slice(at));
    if (typeof j !== "object" || j === null || !("loggedIn" in j)) return null;
    const method = "authMethod" in j && typeof j.authMethod === "string" ? j.authMethod : null;
    return { loggedIn: j.loggedIn === true, method };
  } catch {
    return null;
  }
}

/** One CLI's fact from the fenced output. A key that never printed (the shell died midway) is `unknown`. */
export function factOf(cli: AgentCli, found: Map<string, ProbeOut>): CliFact {
  const label = CLI_LABELS[cli];
  const p = found.get(`${cli}.path`);
  if (!p) return { cli, state: "unknown", path: null, version: null, detail: "the login shell did not say", fix: null };
  const path = p.out || null;
  if (!path) return { cli, state: "missing", path: null, version: null, detail: `${label} is not installed`, fix: INSTALL_LINE[cli] };
  const v = found.get(`${cli}.version`);
  const version = v && v.code === 0 ? (/(\d+\.\d+\.\d+)/.exec(v.out)?.[1] ?? null) : null;
  if (!version) return { cli, state: "missing", path, version: null, detail: `${label} does not start (\`${cli} --version\`: ${firstLine(v?.out ?? "") || `exit ${v?.code ?? "?"}`})`, fix: INSTALL_LINE[cli] };
  const a = found.get(`${cli}.auth`);
  if (!a) return { cli, state: "unknown", path, version, detail: `${version}; sign-in not read`, fix: null };
  if (cli === "claude") {
    const s = claudeAuth(a.out);
    if (a.code === 0 && s?.loggedIn) return { cli, state: "ready", path, version, detail: `${version} · signed in${s.method ? ` (${s.method})` : ""}`, fix: null };
    return { cli, state: "signed-out", path, version, detail: `${label} is not signed in`, fix: LOGIN_LINE[cli] };
  }
  if (a.code === 0) return { cli, state: "ready", path, version, detail: `${version} · ${firstLine(a.out) || "signed in"}`, fix: null };
  return { cli, state: "signed-out", path, version, detail: `${label} is not signed in`, fix: LOGIN_LINE[cli] };
}

/** Every CLI `unknown`, with one reason: the shell hung or could not start. The pick then falls back to the config order. */
export const unknownFacts = (detail: string): CliFact[] => CLIS.map((cli) => ({ cli, state: "unknown" as const, path: null, version: null, detail, fix: null }));

/** Runs a command; the same shape as the Agent tools probe, so the doctor and tests pass theirs. */
export type DetectRun = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string; stderr: string }>;

/** The real run: the login shell in its own process group, cut at `timeoutMs` (the whole group, so a hung profile goes too). */
export function shellRun(timeoutMs: number): DetectRun {
  return (cmd, args, env) => new Promise((resolve) => {
    const c = spawn(cmd, args, { env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "";
    let err = "";
    let cut = false;
    const t = setTimeout(() => { cut = true; try { if (c.pid) process.kill(-c.pid, "SIGKILL"); } catch { c.kill("SIGKILL"); } }, timeoutMs);
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("error", (e) => { clearTimeout(t); resolve({ code: 127, stdout: "", stderr: e.message }); });
    c.on("close", (code) => { clearTimeout(t); resolve({ code: cut ? 124 : (code ?? 1), stdout: out, stderr: err }); });
  });
}

export interface DetectOptions {
  /** The owner's login shell (`$SHELL`, default `/bin/zsh`): what a terminal tab spawns. */
  shell?: string;
  env?: NodeJS.ProcessEnv;
  run?: DetectRun;
  /** A hung login shell answers `unknown` after this (default 15 s). */
  timeoutMs?: number;
}

/** Claude Code and Codex, in that order: one login-shell spawn, about 5 s on the owner's Mac (nvm in `.zshrc`). */
export async function detectClis(o: DetectOptions = {}): Promise<CliFact[]> {
  const env = o.env ?? process.env;
  const shell = o.shell ?? (env.SHELL?.trim() || "/bin/zsh");
  const ms = o.timeoutMs ?? 15_000;
  const r = await (o.run ?? shellRun(ms))(shell, ["-l", "-i", "-c", DETECT_SCRIPT], env).catch((e: Error) => ({ code: 127, stdout: "", stderr: e.message }));
  if (r.code === 124) return unknownFacts(`the login shell did not answer in ${Math.round(ms / 1000)} s`);
  const found = parseDetect(r.stdout);
  if (!found.size) return unknownFacts(`the login shell (${shell}) printed no answer${r.stderr ? `: ${firstLine(r.stderr)}` : ""}`);
  return CLIS.map((cli) => factOf(cli, found));
}

/** `HUB_TERMINAL_SHELL=fake` / `HUB_AGENT_TOOLS=fake` (e2e, refused without HUB_DB): both CLIs ready at the measured versions. */
export const fakeFacts = (versions: Record<AgentCli, string>): CliFact[] => CLIS.map((cli) => ({ cli, state: "ready" as const, path: `/fake/bin/${cli}`, version: versions[cli], detail: `${versions[cli]} · signed in (fake)`, fix: null }));

const REASON: Record<CliState, string> = { ready: "ready", "signed-out": "not signed in", missing: "not installed", unknown: "not checked" };

/** "Claude Code is not signed in · claude auth login": why the pick was not the first choice. */
const whyLine = (f: CliFact | undefined, cli: AgentCli): string => `${CLI_LABELS[cli]} is ${f ? REASON[f.state] : REASON.unknown}${f?.fix ? ` · ${f.fix}` : ""}`;

/**
 * What an automatic start runs (P57 2a): the first READY CLI in `agent.default`'s order; else Claude Code installed but not
 * signed in (its first screen is its own sign-in); else Shell. Codex not signed in is never picked by itself. With no facts,
 * or none known, the config order as before P57. `why` is the one line the dock shows when the pick was not the first choice.
 */
export function pickPreset(facts: readonly CliFact[] | null, defaultCli: AgentCli, hasProject: boolean): { preset: TerminalPreset; why: string | null } {
  if (!hasProject) return { preset: "shell", why: null };
  const order: AgentCli[] = defaultCli === "codex" ? ["codex", "claude"] : ["claude", "codex"];
  const first = order[0] ?? "claude";
  const of = (cli: AgentCli) => facts?.find((f) => f.cli === cli);
  if (!facts || order.every((c) => !of(c) || of(c)?.state === "unknown")) return { preset: first, why: null };
  const ready = order.find((c) => of(c)?.state === "ready");
  if (ready) return { preset: ready, why: ready === first ? null : `${CLI_LABELS[ready]}: ${whyLine(of(first), first)}` };
  const unknown = order.find((c) => of(c)?.state === "unknown");
  if (unknown) return { preset: unknown, why: null };
  if (of("claude")?.state === "signed-out") return { preset: "claude", why: whyLine(of("claude"), "claude") };
  return { preset: "shell", why: `Shell: ${whyLine(of(first), first)}` };
}

export interface Detected { facts: CliFact[]; at: string }

/**
 * The server's cache of {@link detectClis} (P57 1d, 1e): in memory, one run at a time (single flight). An answer where every
 * CLI is ready is kept 10 min, any other 60 s; `refresh` re-detects now (a session ended: he may have installed or signed in).
 */
export function cliDetector(o: { detect: () => Promise<CliFact[]>; now?: () => number; readyTtlMs?: number; notReadyTtlMs?: number }) {
  const now = o.now ?? Date.now;
  let last: (Detected & { ms: number }) | null = null;
  let running: Promise<Detected> | null = null;
  const run = (): Promise<Detected> => (running ??= o.detect().catch((e: Error) => unknownFacts(e.message)).then((facts) => {
    const ms = now();
    last = { facts, at: new Date(ms).toISOString(), ms };
    running = null;
    return { facts, at: last.at };
  }));
  const fresh = (): boolean => {
    if (!last) return false;
    const ttl = last.facts.every((f) => f.state === "ready") ? (o.readyTtlMs ?? 600_000) : (o.notReadyTtlMs ?? 60_000);
    return now() - last.ms < ttl;
  };
  return {
    /** The last answer, never waiting: null before the first one finished. */
    peek: (): Detected | null => (last ? { facts: last.facts, at: last.at } : null),
    /** The cached answer while it is fresh, else a new detection (joined when one runs). */
    get: (): Promise<Detected> => (last && fresh() ? Promise.resolve({ facts: last.facts, at: last.at }) : run()),
    refresh: run,
  };
}
export type CliDetector = ReturnType<typeof cliDetector>;
