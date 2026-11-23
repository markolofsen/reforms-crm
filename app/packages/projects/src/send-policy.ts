// The send policy (P49 S11): who a draft may go to and whether the hub may send without a person. It is server-owned:
// it lives in `state/projects/<slug>/send-policy.json`, which an unattended agent's sandbox cannot write, and it is
// written only by a person (`hub send policy set|migrate`). project.md no longer carries it: a row of these fields
// there is reported (`send_policy_in_project_md`, the project doctor fails) and ignored.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { FIELDS, POLICY_FIELDS, type PolicyField } from "./fields";
import { kindOf } from "./kinds";
import type { LoadedProject } from "./store";
import { SEND_MODES, type ProjectConfig } from "./schema";
import { removeSettings, rewrite } from "./write";

export const POLICY_FILE = "send-policy.json";

export const sendPolicySchema = z
  .object({
    schema: z.literal(1),
    /** `test`: the instance's allow_list; `any`: anyone; a list: exactly these addresses. */
    recipients: z.union([z.literal("test"), z.literal("any"), z.array(z.string().min(3)).min(1)]),
    mode: z.enum(SEND_MODES),
    classes: z.array(z.string()),
    dailyCap: z.number().int().positive(),
    delayMinutes: z.number().int().min(1).max(1440),
    updatedAt: z.string(),
    by: z.string().min(1),
  })
  .strict();
export type SendPolicy = z.infer<typeof sendPolicySchema>;

export interface PolicyState {
  /** `file`: read from send-policy.json; `default`: no file (or an unreadable one): the safest values apply. */
  source: "file" | "default";
  policy: SendPolicy;
  file: string;
  /** Why the file could not be used; the defaults apply and the doctor fails. */
  error?: string;
}

/** `<policyDir>/<slug>/send-policy.json`; `policyDir` is `hubPaths().stateProjects`. */
export const policyFile = (policyDir: string, slug: string): string => join(policyDir, slug, POLICY_FILE);

/** Drafts only, to the test allow-list: what a project gets until a person writes a policy. */
export function defaultPolicy(kindId: string): SendPolicy {
  const k = kindOf(kindId)?.send;
  return { schema: 1, recipients: "test", mode: "draft", classes: [], dailyCap: k?.dailyCap ?? 5, delayMinutes: k?.delayMinutes ?? 10, updatedAt: "", by: "default" };
}

export function readSendPolicy(policyDir: string, slug: string, kindId: string): PolicyState {
  const file = policyFile(policyDir, slug);
  if (!existsSync(file)) return { source: "default", policy: defaultPolicy(kindId), file };
  try {
    const r = sendPolicySchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (r.success) return { source: "file", policy: r.data, file };
    return { source: "default", policy: defaultPolicy(kindId), file, error: `${file}: ${r.error.issues[0]?.path.join(".") || "file"}: ${r.error.issues[0]?.message ?? "invalid"}` };
  } catch (e) {
    return { source: "default", policy: defaultPolicy(kindId), file, error: `${file}: ${(e as Error).message}` };
  }
}

/** The config the send checks read: project.md's facts with the policy's send and recipients. */
export const applySendPolicy = (config: ProjectConfig, p: SendPolicy): ProjectConfig => ({
  ...config,
  send: { mode: p.mode, classes: [...p.classes], dailyCap: p.dailyCap, delayMinutes: p.delayMinutes },
  draft: { recipients: Array.isArray(p.recipients) ? [...p.recipients] : p.recipients },
});

/** What makes a policy unusable for its project's kind (the same rules project.md had). */
export function policyProblems(p: SendPolicy, kindId: string): string[] {
  const kind = kindOf(kindId);
  const out: string[] = [];
  const unknown = p.classes.filter((c) => !kind?.send.classes.includes(c));
  if (unknown.length) out.push(`${unknown.join(", ")}: not a class a ${kindId} project may autosend (allowed: ${kind?.send.classes.join(", ") ?? "none"})`);
  if (p.mode === "auto" && p.classes.length === 0) out.push("send.mode is auto but send.classes is empty: nothing could be sent");
  return out;
}

const KEY: Record<PolicyField, keyof SendPolicy> = { "draft.recipients": "recipients", "send.mode": "mode", "send.classes": "classes", "send.daily_cap": "dailyCap", "send.delay_minutes": "delayMinutes" };

/** Text values in the project.md spelling (`send.mode auto`) onto a policy. An empty value restores that field's default. Throws on a bad value. */
export function withFieldValues(base: SendPolicy, kindId: string, values: Partial<Record<PolicyField, string>>): SendPolicy {
  const def = defaultPolicy(kindId);
  const next: Record<string, unknown> = { ...base };
  for (const [field, text] of Object.entries(values) as Array<[PolicyField, string]>) {
    const key = KEY[field];
    if (text.trim() === "") { next[key] = def[key]; continue; }
    const r = (FIELDS[field] as (typeof FIELDS)[string]).schema.safeParse(text.trim());
    if (!r.success) throw new Error(`${field}: ${r.error.issues[0]?.message ?? "bad value"}`);
    next[key] = r.data;
  }
  return sendPolicySchema.parse(next);
}

/** Writes the policy (temp file, then rename). The only writer; a person's command calls it. */
export function writeSendPolicy(policyDir: string, slug: string, p: SendPolicy): string {
  const file = policyFile(policyDir, slug);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(sendPolicySchema.parse(p), null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}

/** `hub send policy set`: validated against the kind, stamped with who and when, written. */
export function setSendPolicy(policyDir: string, slug: string, kindId: string, values: Partial<Record<PolicyField, string>>, by: string, now: Date = new Date()): SendPolicy {
  const cur = readSendPolicy(policyDir, slug, kindId).policy;
  const next = { ...withFieldValues(cur, kindId, values), updatedAt: now.toISOString(), by };
  const problems = policyProblems(next, kindId);
  if (problems.length) throw new Error(problems.join("; "));
  writeSendPolicy(policyDir, slug, next);
  return next;
}

export interface MigrateResult {
  slug: string;
  /** `moved`: project.md's rows became send-policy.json; `created`: no rows and no file, the defaults were written; `kept`: a policy file exists and wins (rows found in project.md are removed, not applied); `none`: nothing to do. */
  outcome: "moved" | "created" | "kept" | "none";
  policy: SendPolicy;
  removed: string[];
}

/**
 * `hub send policy migrate <slug>`: the owner's send rows of project.md become send-policy.json (their values kept),
 * then the rows are removed. A policy file that already exists wins: rows that reappeared in project.md after a
 * migration were not written by the owner's command, so they are removed without being applied. Dry run unless `apply`.
 */
export function migrateSendPolicy(project: LoadedProject, policyDir: string, o: { apply: boolean; by?: string; now?: Date }): MigrateResult {
  const kindId = project.parsed.config.kind;
  const rows = project.parsed.policyRows;
  const removed = Object.keys(rows);
  const state = readSendPolicy(policyDir, project.slug, kindId);
  let outcome: MigrateResult["outcome"];
  let policy = state.policy;
  if (state.source === "file") outcome = removed.length ? "kept" : "none";
  else {
    const values = Object.fromEntries(Object.values(rows).map((r) => [r.field, r.value])) as Partial<Record<PolicyField, string>>;
    policy = { ...withFieldValues(defaultPolicy(kindId), kindId, values), updatedAt: (o.now ?? new Date()).toISOString(), by: o.by ?? "migrate" };
    const problems = policyProblems(policy, kindId);
    if (problems.length) throw new Error(`${project.slug}: ${problems.join("; ")}`);
    if (o.apply) writeSendPolicy(policyDir, project.slug, policy);
    outcome = removed.length ? "moved" : "created";
  }
  if (o.apply && removed.length) rewrite(project.file, (t) => removeSettings(t, POLICY_FIELDS));
  return { slug: project.slug, outcome, policy, removed };
}
