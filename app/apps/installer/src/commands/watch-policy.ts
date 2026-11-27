import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HubPaths } from "@hub/config/paths";
import { policyGeneration, readWatchPolicy, watchPolicyFile, watchPolicySchema } from "@hub/watch/policy";
import { inAgentSession } from "./sequences";

/** Supported owner-shell writer. Session restrictions are enforced, never cleared or replaced. */
export function setWatchPolicy(paths: Pick<HubPaths, "stateProjects" | "projects">, project: string, candidate: unknown, env: NodeJS.ProcessEnv = process.env) {
  if (inAgentSession(env)) throw new Error("Public action grants can be changed only through the owner CLI outside a Hub agent session (decision 0061).");
  const file = watchPolicyFile(paths.stateProjects, project);
  const projectDir = join(paths.projects, project);
  if (!existsSync(join(projectDir, "project.md"))) throw new Error("The project must already exist.");
  const policy = watchPolicySchema.parse(candidate);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const lockFd = openSync(lock, "wx", 0o600);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const audit = join(dirname(file), "watch-policy.audit.jsonl");
  try {
    const previous = existsSync(file) ? watchPolicySchema.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
    if (policy.revision !== (previous?.revision ?? 0) + 1) throw new Error(`Expected policy revision ${(previous?.revision ?? 0) + 1}.`);
    const payload = JSON.stringify(policy, null, 2) + "\n";
    writeFileSync(temporary, payload, { mode: 0o600, flag: "wx" });
    const fd = openSync(temporary, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const valid = readWatchPolicy(projectDir, temporary);
    if (valid.state !== "ok") throw new Error(valid.state === "invalid" ? valid.reason : "Policy validation failed.");
    const generation = policyGeneration(policy);
    const event = { at: new Date().toISOString(), by: "owner_cli", project, requestRef: policy.approval.requestRef,
      revision: policy.revision, generation, previousGeneration: previous ? policyGeneration(previous) : null, policy };
    // Intent is durable before activation; a crash is reconciled by the effective file's generation, never assumed applied.
    appendFileSync(audit, JSON.stringify({ ...event, phase: "prepared" }) + "\n", { mode: 0o600 });
    const auditFd = openSync(audit, "r");
    try { fsyncSync(auditFd); } finally { closeSync(auditFd); }
    renameSync(temporary, file);
    const dirFd = openSync(dirname(file), "r");
    try { fsyncSync(dirFd); } catch (error) {
      const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
      if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
    } finally { closeSync(dirFd); }
    appendFileSync(audit, JSON.stringify({ ...event, phase: "applied" }) + "\n", { mode: 0o600 });
    return { ok: true, project, revision: policy.revision, generation, file, enabled: policy.enabled };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
