import path from "node:path";
import { agentChecks, defaultProbe, type AgentCheckRow } from "@hub/agent/checks";
import { detectClis, pickPreset, type CliFact, type DetectRun } from "@hub/agent/detect";
import { AGENT_CLIS, instanceFeatures, instancePorts, type AgentCli } from "@hub/config/paths";
import { listProjects, type Ctx } from "../context";
import type { CheckResult, Step } from "../types";
import { fail, pass, warn } from "./helpers";
import { listenersOf } from "./admin";
import { ensureSpawnHelper, nodePtyRoot, tabShell, terminalReadiness } from "@hub/terminal/readiness";

// The `Agent` doctor group (P49 5B): the Agent tools rows of Connections, one doctor row per project and CLI, the
// embedded terminal's own check (always on, decision 0032) and the CLIs on the login shell (P66). `hub doctor --only Agent` prints what the Connections block shows.

const why = "A hub agent session needs its CLI, its session files, the hub's MCP servers answering, the send tools off and its mode (prompts, or the OS sandbox) in place; a missing piece shows only when the owner starts the session.";
const verifies = "For each project and each CLI (Claude Code, Codex): the CLI is found by the owner's login shell and answers `--version` (another version than the measured one is a WARN), it is signed in (`claude auth status`, `codex login status`), the session files exist, each hub MCP server is configured and answers `tools/list` (Notion not signed in is a WARN), no tool that sends is reachable, the skills are linked, the mode matches `agent.unattended` (no Codex sandbox bypass), the send policy file parses, Claude's guard hook is set and the session log hooks are in the session files (P54).";

/** Worst state of a CLI's rows: one doctor line, with the first red row's fix. */
export function summarise(rows: AgentCheckRow[]): CheckResult {
  const bad = rows.filter((r) => r.state === "fail");
  const soft = rows.filter((r) => r.state === "warn");
  const line = (r: AgentCheckRow) => `${r.title}: ${r.detail}${r.fix ? ` (fix: ${r.fix})` : ""}`;
  if (bad.length) return fail(bad.map(line).join(" | "));
  if (soft.length) return warn(soft.map(line).join(" | "));
  return pass(`${rows.filter((r) => r.state === "pass").length} checks pass`);
}

/** One detection per doctor run (P57): the owner's login shell, the environment a terminal tab gets, never the doctor's own PATH. */
const detected = new WeakMap<Ctx, Promise<CliFact[]>>();
function factsOf(ctx: Ctx, run: DetectRun): Promise<CliFact[]> {
  let f = detected.get(ctx);
  if (!f) { f = detectClis({ run }); detected.set(ctx, f); }
  return f;
}

async function checkCli(ctx: Ctx, slug: string, cli: AgentCli): Promise<CheckResult> {
  const run: DetectRun = async (cmd, args, env) => ctx.run(cmd, args, env ? { env: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string")) } : {});
  const probe = { ...defaultProbe(), run };
  return summarise(await agentChecks({ paths: ctx.paths, slug, cli, unattended: instanceFeatures(ctx.paths).agent.unattended, probe, facts: await factsOf(ctx, run) }));
}

function cliStep(id: string, title: string, check: (ctx: Ctx) => Promise<CheckResult>): Step {
  return { id, group: "Agent", title, why, verifies, check, manual: { steps: ["Run the fix the row names (most often `hub agent <project> --prepare`, with `--cli codex` for Codex).", "Run `hub doctor --only Agent` again, or Refresh on Settings ▸ Agent in the admin."] } };
}

/** The core's `app/`, where the terminal's node-pty lives (the pinned core's, not the doctor's own checkout when they differ). */
const coreApp = (ctx: Ctx) => path.join(ctx.paths.core, "app");

const CLI_NAME: Record<AgentCli, string> = { claude: "Claude Code", codex: "Codex" };

/** One CLI's fact as one clause: `Claude Code 2.1.220 ready`, `Codex missing (fix: npm i -g @openai/codex)`. */
export function cliClause(f: CliFact): string {
  const name = CLI_NAME[f.cli];
  if (f.state === "ready") return `${name}${f.version ? ` ${f.version}` : ""} ready`;
  if (f.state === "unknown") return `${name} not checked (${f.detail})`;
  return `${name}${f.version ? ` ${f.version}` : ""} ${f.state === "missing" ? "missing" : "not signed in"}${f.fix ? ` (fix: ${f.fix})` : ""}`;
}

/**
 * The `agent.clis` row (P66): one clause per CLI, then what opening the column in a project starts (`pickPreset` with
 * `agent.default`) and why when it is not the first choice. WARN when a CLI is not ready or the shell did not answer, never
 * FAIL: the terminal works with Shell alone, and an owner may use one CLI only.
 */
export function clisRow(facts: readonly CliFact[], defaultCli: AgentCli): CheckResult {
  const pick = pickPreset(facts, defaultCli, true);
  const opens = `opening the column starts ${pick.preset === "shell" ? "Shell" : CLI_NAME[pick.preset]}${pick.why ? ` (${pick.why})` : ""}`;
  const line = `${facts.map(cliClause).join("; ")}; ${opens}`;
  if (facts.length && facts.every((f) => f.state === "unknown")) return warn(`${line}. Check the login shell's profile ($SHELL -l -i is cut after 15 s)`);
  return facts.some((f) => f.state !== "ready") ? warn(line) : pass(line);
}

export const agentSteps: Step[] = [
  {
    ...cliStep("agent.tools", "Agent tools (one row per project and CLI)", async (ctx) => {
      const slugs = listProjects(ctx);
      if (!slugs.length) return pass("no projects");
      const all = await Promise.all(slugs.flatMap((s) => AGENT_CLIS.map((c) => checkCli(ctx, s, c))));
      return all.find((r) => r.level === "fail") ?? all.find((r) => r.level === "warn") ?? pass(`${all.length} sessions ready`);
    }),
    async expand(ctx) {
      const slugs = listProjects(ctx);
      if (!slugs.length) return [cliStep("agent.tools", "Agent tools", async () => pass("no projects"))];
      return slugs.flatMap((s) => AGENT_CLIS.map((c) => cliStep(`agent.${s}.${c}`, `${s}: ${c === "claude" ? "Claude Code" : "Codex"} session`, (x) => checkCli(x, s, c))));
    },
  },
  {
    id: "agent.terminal", group: "Agent", title: "Embedded terminal",
    why: "The admin's terminal runs a real PTY in the local server and is always on (decision 0032). It needs node-pty to load on this Node, its native spawn-helper to be executable (pnpm unpacks it without the bit) and the owner's shell; the server must listen on 127.0.0.1 only. A piece that is missing shows only when he opens the column.",
    verifies: "node-pty is installed in the core and loads on this Node, its spawn-helper is executable, the shell a tab starts (`$SHELL`, else /bin/zsh) exists, the API port listens on 127.0.0.1 only, and a running server reports no problem (`GET /api/terminal`, `problem: null`). The same check the server runs at start (`terminalReadiness`), so the doctor and the column cannot disagree.",
    does: "sets the execute bit on node-pty's spawn-helper in the core (adds only +x)",
    async check(ctx) {
      const problem = terminalReadiness({ app: coreApp(ctx), shell: tabShell(process.env) });
      if (problem) return fail(`${problem.reason} (fix: ${problem.fix})`);
      const port = instancePorts(ctx.paths).api;
      const open = (await listenersOf(ctx, port)).filter((l) => /^(\*|0\.0\.0\.0|\[::\]):/.test(l));
      if (open.length) return fail(`port ${port} listens on ${open.join(", ")}: the terminal must be loopback only`);
      try {
        const r = await ctx.fetch(`http://127.0.0.1:${port}/api/terminal`, { signal: AbortSignal.timeout(4000) });
        const s = (await r.json().catch(() => ({}))) as { problem?: { reason: string; fix: string } | null };
        if (s.problem) return warn(`the running server says: ${s.problem.reason} (fix: ${s.problem.fix}); restart it with ./run.sh up once fixed`);
        return pass(r.ok ? `ready, served on 127.0.0.1:${port}` : `ready (the server answered ${r.status})`);
      } catch {
        return pass("ready (the server is not running)");
      }
    },
    async apply(ctx) {
      const root = nodePtyRoot(coreApp(ctx));
      if (!root) return "node-pty is not installed: nothing to set";
      const helper = ensureSpawnHelper(root);
      return helper ? `set the execute bit on ${helper}` : "node-pty has no prebuilt spawn-helper for this machine: nothing to set";
    },
  },
  {
    id: "agent.clis", group: "Agent", title: "Claude Code and Codex on the login shell",
    why: "Opening the terminal column starts Claude Code or Codex by itself (P57) through the owner's login shell, so a CLI the doctor's PATH finds can still be missing there. The install workflow names each one's state and its one fix line.",
    verifies: "One detection (each CLI directly first, the login shell `$SHELL -l -i` only for one that is not settled, 45 s): each CLI found, answering `--version` and signed in, and what opening the column in a project starts (`agent.default`'s order). Not ready is a WARN with the install or sign-in line, never a FAIL: the terminal works with Shell alone.",
    manual: { steps: ["Install a missing CLI with the line the row names (`npm i -g @anthropic-ai/claude-code` or `npm i -g @openai/codex`).", "Sign in with `claude auth login` or `codex login` (the sign-in is yours).", "Run `hub doctor --only Agent` again, or Refresh on Settings ▸ Agent in the admin."] },
    async check(ctx) {
      const run: DetectRun = async (cmd, args, env) => ctx.run(cmd, args, env ? { env: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string")) } : {});
      return clisRow(await factsOf(ctx, run), instanceFeatures(ctx.paths).agent.default);
    },
  },
];
