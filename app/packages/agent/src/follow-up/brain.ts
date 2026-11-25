import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { FOLLOW_UP_MAX_TURNS, FOLLOW_UP_MODEL, type FollowUpBrain, type FollowUpTurn, type FollowUpTurnResult } from "@hub/config/follow-ups";
import { throwawayDb } from "@hub/config/paths";
import { errFields, ops } from "@hub/log/ops";
import type { ClaudeBrainDeps, Spawn } from "../autopilot/brain";
import { initRefusal } from "../autopilot/stream";
import { autopilotEnv } from "../autopilot/session";
import { projectCapability } from "../mcp/binding";
import { FOLLOW_UP_ALLOWED, followUpArgs, followUpDir, followUpMcp, followUpPrompt, followUpSettings, followUpSkillText } from "./session";
import { sweepStream } from "./stream";

// The follow-up sweep's brain (decision 0050 point 3, P142 F4): `claudeBrain`'s second turn kind. One headless `claude -p` per
// client on the owner's Claude sign-in, the A0 rules of autopilot's turn, bound to one client with nine tools. It answers what
// the turn's own `follow_up_plan` and nudge draft calls wrote; it holds no send. The sweep's signal aborts it (the 120 s wall
// clock): SIGTERM, then SIGKILL, its hub MCP child with it.

const log = ops("follow-ups");

export function followUpClaudeBrain(d: ClaudeBrainDeps): FollowUpBrain {
  const spawn = d.spawn ?? (nodeSpawn as Spawn);
  const env = d.env ?? process.env;
  const claude = d.claudeBin ?? path.join(path.dirname(d.nodeBin), "claude");
  return {
    name: "claude",
    async turn(t: FollowUpTurn, signal): Promise<FollowUpTurnResult> {
      const skill = followUpSkillText(d.paths);
      if (!skill) return { kind: "failed", code: "failed", detail: "the core has no follow-up-sweep skill" };
      const dir = followUpDir(d.paths, t.project, t.client);
      mkdirSync(dir, { recursive: true });
      const files = { settings: path.join(dir, "settings.json"), mcp: path.join(dir, "mcp.json"), skill: path.join(dir, "skill.md") };
      writeFileSync(files.settings, `${JSON.stringify(followUpSettings(dir, env.HOME ?? ""), null, 2)}\n`);
      const db = throwawayDb(d.paths) ? d.paths.db : undefined;
      writeFileSync(files.mcp, `${JSON.stringify(followUpMcp({ paths: d.paths, nodeBin: d.nodeBin, turn: t, capability: projectCapability(d.paths, t.project), db }), null, 2)}\n`, { mode: 0o600 });
      writeFileSync(files.skill, `${skill}\n`);
      const args = followUpArgs(files, d.model ?? FOLLOW_UP_MODEL, d.maxTurns ?? FOLLOW_UP_MAX_TURNS);
      return run(spawn, claude, args, { cwd: dir, env: autopilotEnv(env, d.nodeBin) }, followUpPrompt(t), signal, d.killGraceMs ?? 3_000);
    },
  };
}

function run(spawn: Spawn, cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, prompt: string, signal: Parameters<FollowUpBrain["turn"]>[1], graceMs: number): Promise<FollowUpTurnResult> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ kind: "failed", code: "failed", detail: "aborted before the start" });
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      log.error("the follow-up CLI did not start", { cmd, ...errFields(e) });
      return resolve({ kind: "failed", code: "failed", detail: `claude did not start: ${e instanceof Error ? e.message : String(e)}` });
    }
    const stream = sweepStream();
    let refused: string | null = null;
    let stderr = "";
    let settled = false;
    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const h = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, graceMs);
      h.unref?.();
    };
    signal.addEventListener("abort", kill, { once: true });
    const finish = (r: FollowUpTurnResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.on("error", (e) => finish({ kind: "failed", code: "failed", detail: `claude failed: ${e.message}` }));
    child.stderr?.on("data", (b: Buffer) => {
      if (stderr.length < 2_000) stderr += b.toString("utf8");
    });
    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        const init = stream.push(line);
        if (init && refused === null) {
          refused = initRefusal(init, FOLLOW_UP_ALLOWED);
          if (refused) kill();
        }
      });
    }
    child.on("close", (code) => {
      const s = stream.done();
      const cost = s.final?.costUsd ?? null;
      if (signal.aborted) return finish({ kind: "failed", code: "timeout", detail: "aborted", costUsd: cost });
      if (!s.init) return finish({ kind: "failed", code: "mcp_not_ready", detail: `the turn never started (exit ${code ?? "?"}): ${stderr.trim().slice(0, 300)}` });
      if (refused) return finish({ kind: "failed", code: "mcp_not_ready", detail: refused });
      if (!s.final) return finish({ kind: "failed", code: "failed", detail: `the turn gave no result (exit ${code ?? "?"})`, costUsd: cost });
      if (s.final.isError) return finish({ kind: "failed", code: "failed", detail: `the turn ended in an error (${s.final.subtype ?? "error"}): ${s.final.result}`, costUsd: cost });
      if (s.final.denials > 0) return finish({ kind: "failed", code: "failed", detail: `the turn asked for ${s.final.denials} tool call(s) it may not make`, costUsd: cost });
      if (!s.decision) return finish({ kind: "undecided", reason: s.final.result || "the assistant recorded no decision", costUsd: cost });
      finish({ kind: "decided", decision: s.decision, nudge: s.nudge?.send ? { draftId: s.nudge.draftId, text: s.nudge.text, sendAfter: s.nudge.sendAfter, chat: s.nudge.chat } : null, costUsd: cost });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}
