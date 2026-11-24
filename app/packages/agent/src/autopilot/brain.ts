import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { AUTOPILOT_MAX_TURNS, AUTOPILOT_MODEL, type AutopilotBrain, type BrainResult, type BrainTurn, type TurnSignal } from "@hub/config/autopilot";
import { throwawayDb, type HubPaths } from "@hub/config/paths";
import { errFields, ops } from "@hub/log/ops";
import { projectCapability } from "../mcp/binding";
import { AUTOPILOT_ALLOWED, autopilotArgs, autopilotDir, autopilotEnv, autopilotMcp, autopilotPrompt, autopilotSettings, autopilotSkillText } from "./session";
import { initRefusal, turnStream } from "./stream";

// The autopilot's brain (decision 0048, P139 A3; verdict 7, A0): one headless `claude -p` per turn on the owner's Claude sign-in
// (his plan, no key), bound to one chat. It writes the turn's files, spawns the CLI beside the Hub's own Node, reads its stream,
// and answers what the turn's own `messenger_draft_write` call wrote. It holds no send and never touches a sender: the server's
// runner (`apps/server/src/messengers/autopilot`) does the rest through the door. The scheduler's signal aborts it (the 120 s
// wall clock, a newer message, a switch): the CLI gets SIGTERM, then SIGKILL; its hub MCP child goes with it (A0).

export type Spawn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

export interface ClaudeBrainDeps {
  paths: Pick<HubPaths, "home" | "stateProjects" | "secrets" | "skills" | "hubBin" | "db">;
  /** The Hub's own Node (`process.execPath` of the server): the hub MCP runs on it, and `claude` sits beside it. */
  nodeBin: string;
  /** Default: `claude` in the Node's folder (the Hub's Claude Code, 2.1.220 when measured), never one found on PATH. */
  claudeBin?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: Spawn;
  model?: string;
  maxTurns?: number;
  /** How long a SIGTERM may take before SIGKILL. */
  killGraceMs?: number;
}

const log = ops("autopilot");

export function claudeBrain(d: ClaudeBrainDeps): AutopilotBrain {
  const spawn = d.spawn ?? (nodeSpawn as Spawn);
  const env = d.env ?? process.env;
  const claude = d.claudeBin ?? path.join(path.dirname(d.nodeBin), "claude");
  return {
    name: "claude",
    async turn(t: BrainTurn, signal: TurnSignal): Promise<BrainResult> {
      const skill = autopilotSkillText(d.paths);
      if (!skill) return { kind: "failed", code: "failed", detail: "the core has no autopilot-reply skill" };
      const dir = autopilotDir(d.paths, t.chat.project, t.chat.chat);
      mkdirSync(dir, { recursive: true });
      const files = { settings: path.join(dir, "settings.json"), mcp: path.join(dir, "mcp.json"), skill: path.join(dir, "skill.md") };
      writeFileSync(files.settings, `${JSON.stringify(autopilotSettings(dir, env.HOME ?? ""), null, 2)}\n`);
      const db = throwawayDb(d.paths) ? d.paths.db : undefined;
      writeFileSync(files.mcp, `${JSON.stringify(autopilotMcp({ paths: d.paths, nodeBin: d.nodeBin, turn: t, capability: projectCapability(d.paths, t.chat.project), db }), null, 2)}\n`, { mode: 0o600 });
      writeFileSync(files.skill, `${skill}\n`);
      return run(spawn, claude, autopilotArgs(files, d.model ?? AUTOPILOT_MODEL, d.maxTurns ?? AUTOPILOT_MAX_TURNS), { cwd: dir, env: autopilotEnv(env, d.nodeBin) }, autopilotPrompt(t), signal, d.killGraceMs ?? 3_000);
    },
  };
}

function run(spawn: Spawn, cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, prompt: string, signal: TurnSignal, graceMs: number): Promise<BrainResult> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ kind: "failed", code: "failed", detail: "aborted before the start" });
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      log.error("the autopilot CLI did not start", { cmd, ...errFields(e) });
      return resolve({ kind: "failed", code: "failed", detail: `claude did not start: ${e instanceof Error ? e.message : String(e)}` });
    }
    const stream = turnStream();
    let refused: string | null = null;
    let stderr = "";
    let settled = false;
    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const t = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, graceMs);
      t.unref?.();
    };
    signal.addEventListener("abort", kill, { once: true });
    const finish = (r: BrainResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.on("error", (e) => {
      log.error("the autopilot CLI failed", { cmd, ...errFields(e) });
      finish({ kind: "failed", code: "failed", detail: `claude failed: ${e.message}` });
    });
    child.stderr?.on("data", (b: Buffer) => {
      if (stderr.length < 2_000) stderr += b.toString("utf8");
    });
    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        const init = stream.push(line);
        if (init && refused === null) {
          refused = initRefusal(init, AUTOPILOT_ALLOWED);
          if (refused) kill();
        }
      });
    }
    child.on("close", (code) => {
      const s = stream.done();
      const cost = s.final?.costUsd ?? null;
      if (signal.aborted) return finish({ kind: "failed", code: "failed", detail: "aborted", costUsd: cost });
      if (!s.init) return finish({ kind: "failed", code: "mcp_not_ready", detail: `the turn never started (exit ${code ?? "?"}): ${stderr.trim().slice(0, 300)}` });
      if (refused) return finish({ kind: "failed", code: "mcp_not_ready", detail: refused });
      if (!s.final) return finish({ kind: "failed", code: "failed", detail: `the turn gave no result (exit ${code ?? "?"}): ${stderr.trim().slice(0, 300)}`, costUsd: cost });
      if (s.final.isError) return finish({ kind: "failed", code: "failed", detail: `the turn ended in an error (${s.final.subtype ?? "error"}): ${s.final.result}`, costUsd: cost });
      if (s.final.denials > 0) return finish({ kind: "failed", code: "failed", detail: `the turn asked for ${s.final.denials} tool call(s) it may not make`, costUsd: cost });
      if (s.draft) return finish({ kind: "draft", draftId: s.draft.draftId, text: s.draft.text, verdict: s.draft.verdict, reason: s.draft.reason, costUsd: cost });
      finish({ kind: "no_draft", reason: s.final.result || "the assistant wrote no reply", costUsd: cost });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}
