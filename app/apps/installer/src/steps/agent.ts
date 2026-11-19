import { accessSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { agentChecks, defaultProbe, type AgentCheckRow } from "@hub/agent/checks";
import { detectClis, type CliFact, type DetectRun } from "@hub/agent/detect";
import { AGENT_CLIS, instanceFeatures, instancePorts, type AgentCli } from "@hub/config/paths";
import { listProjects, type Ctx } from "../context";
import type { CheckResult, Step } from "../types";
import { fail, pass, warn } from "./helpers";
import { listenersOf } from "./admin";

// The `Agent` doctor group (P49 5B): the Agent tools rows of Connections, one doctor row per project and CLI, and the
// embedded terminal's own check. `hub doctor --only Agent` prints what the Connections block shows.

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
  return { id, group: "Agent", title, why, verifies, check, manual: { steps: ["Run the fix the row names (most often `hub agent <project> --prepare`, with `--cli codex` for Codex).", "Run `hub doctor --only Agent` again, or Refresh in Connections, Agent tools."] } };
}

/** The node-pty helper the server spawns through; pnpm unpacks it without the execute bit (the server sets it at start). */
export function spawnHelperOf(core: string): string | null {
  try {
    const req = createRequire(path.join(core, "app", "packages", "terminal", "package.json"));
    const helper = path.join(path.dirname(req.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    return existsSync(helper) ? helper : null;
  } catch { return null; }
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
    why: "The admin's terminal runs a real PTY in the local server. Off by default; on, its native helper must be executable and the server must listen on 127.0.0.1 only.",
    verifies: "`terminal.enabled` in config/config.json; when on: node-pty's spawn-helper exists and is executable, the API port listens on 127.0.0.1 only, and a running server reports the same switch (`GET /api/terminal`).",
    manual: { steps: ["Set `terminal.enabled: true` in `config/config.json` (or false to turn it off), then restart with `./run.sh up`."] },
    async check(ctx) {
      const on = instanceFeatures(ctx.paths).terminal.enabled;
      if (!on) return pass("off (terminal.enabled in config/config.json)");
      const helper = spawnHelperOf(ctx.paths.core);
      if (!helper) return fail("node-pty has no prebuilt helper for this machine: run `pnpm install` in the core's app/");
      try { accessSync(helper, constants.X_OK); } catch { return warn(`${helper} is not executable (the server sets it on start; or: chmod +x ${helper})`); }
      const port = instancePorts(ctx.paths).api;
      const open = (await listenersOf(ctx, port)).filter((l) => /^(\*|0\.0\.0\.0|\[::\]):/.test(l));
      if (open.length) return fail(`port ${port} listens on ${open.join(", ")}: the terminal must be loopback only`);
      try {
        const r = await ctx.fetch(`http://127.0.0.1:${port}/api/terminal`, { signal: AbortSignal.timeout(4000) });
        const s = (await r.json().catch(() => ({}))) as { enabled?: boolean };
        return s.enabled === true ? pass(`on, served on 127.0.0.1:${port}`) : warn("on in the config, off in the running server: restart it with ./run.sh up");
      } catch {
        return pass("on (the server is not running)");
      }
    },
  },
];
