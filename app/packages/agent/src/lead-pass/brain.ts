import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { LEAD_PASS_MAX_TURNS, LEAD_PASS_MODEL, type LeadPassBrain, type LeadPassTurn, type LeadPassTurnResult } from "@hub/config/lead-pass";
import { throwawayDb } from "@hub/config/paths";
import { errFields, ops } from "@hub/log/ops";
import type { ClaudeBrainDeps, Spawn } from "../autopilot/brain";
import { initRefusal } from "../autopilot/stream";
import { autopilotEnv } from "../autopilot/session";
import { projectCapability } from "../mcp/binding";
import { LEAD_PASS_ALLOWED, leadPassArgs, leadPassDir, leadPassMcp, leadPassPrompt, leadPassSettings, leadPassSkillText } from "./session";
import { leadStream } from "./stream";

// The lead pass's brain (decision 0055 point 1, P147 L4): `claudeBrain`'s third turn kind, `lead_pass`. One headless `claude -p`
// per lead on the owner's Claude sign-in, P142's rules, bound to one lead with six tools. It answers what the turn's own
// `lead_decide` call wrote; it holds no send. The pass's signal aborts it (the 120 s wall clock): SIGTERM, then SIGKILL.

const log = ops("lead-pass");

export function leadPassClaudeBrain(d: ClaudeBrainDeps): LeadPassBrain {
  const spawn = d.spawn ?? (nodeSpawn as Spawn);
  const env = d.env ?? process.env;
  const claude = d.claudeBin ?? path.join(path.dirname(d.nodeBin), "claude");
  return {
    name: "claude",
    async turn(t: LeadPassTurn, signal): Promise<LeadPassTurnResult> {
      const skill = leadPassSkillText(d.paths);
      if (!skill) return { kind: "failed", code: "failed", detail: "the core has no lead-pass skill" };
      const dir = leadPassDir(d.paths, t.project, t.pageId);
      mkdirSync(dir, { recursive: true });
      const files = { settings: path.join(dir, "settings.json"), mcp: path.join(dir, "mcp.json"), skill: path.join(dir, "skill.md") };
      writeFileSync(files.settings, `${JSON.stringify(leadPassSettings(dir, env.HOME ?? ""), null, 2)}\n`);
      const db = throwawayDb(d.paths) ? d.paths.db : undefined;
      writeFileSync(files.mcp, `${JSON.stringify(leadPassMcp({ paths: d.paths, nodeBin: d.nodeBin, turn: t, capability: projectCapability(d.paths, t.project), db }), null, 2)}\n`, { mode: 0o600 });
      writeFileSync(files.skill, `${skill}\n`);
      const args = leadPassArgs(files, d.model ?? LEAD_PASS_MODEL, d.maxTurns ?? LEAD_PASS_MAX_TURNS);
      return run(spawn, claude, args, { cwd: dir, env: autopilotEnv(env, d.nodeBin) }, leadPassPrompt(t), signal, d.killGraceMs ?? 3_000);
    },
  };
}

function run(spawn: Spawn, cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, prompt: string, signal: Parameters<LeadPassBrain["turn"]>[1], graceMs: number): Promise<LeadPassTurnResult> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ kind: "failed", code: "failed", detail: "aborted before the start" });
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      log.error("the lead pass CLI did not start", { cmd, ...errFields(e) });
      return resolve({ kind: "failed", code: "failed", detail: `claude did not start: ${e instanceof Error ? e.message : String(e)}` });
    }
    const stream = leadStream();
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
    const finish = (r: LeadPassTurnResult) => {
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
          refused = initRefusal(init, LEAD_PASS_ALLOWED);
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
      finish({ kind: "decided", decision: s.decision, costUsd: cost });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}
