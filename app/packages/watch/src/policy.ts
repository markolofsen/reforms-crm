import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { DIRECTION_ID } from "./config";

/** Owner-granted public actions. The server reads this policy; discussion text never changes it. */
export const WATCH_POLICY_FILE = "watch-policy.json";
export const watchPolicyFile = (stateProjectsDir: string, slug: string): string => {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new Error("Invalid project slug");
  return join(stateProjectsDir, slug, WATCH_POLICY_FILE);
};
const username = z.string().regex(/^[a-z][a-z0-9_]{3,31}$/);
const strategy = z.strictObject({ path: z.string().min(1).max(300), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const direction = z.strictObject({ groups: z.array(username).min(1).max(100), join: z.boolean(), reply: z.boolean(), strategy: strategy.optional() })
  .refine((d) => !d.reply || d.strategy !== undefined, "A reply grant requires a strategy path and digest.")
  .refine((d) => new Set(d.groups).size === d.groups.length, "Group usernames must be unique.");
export const watchPolicySchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().min(1), enabled: z.boolean(),
  account: z.string().regex(/^[0-9]{3,20}$/),
  approval: z.strictObject({ requestRef: z.string().min(8).max(1000), approvedAt: z.iso.datetime() }),
  directions: z.record(z.string().regex(DIRECTION_ID), direction),
  limits: z.strictObject({ joinsPerDay: z.number().int().min(0).max(20), repliesPerDay: z.number().int().min(0).max(20) }),
});
export type WatchPolicy = z.infer<typeof watchPolicySchema>;
export type WatchPolicyRead = { state: "none" } | { state: "invalid"; reason: string } | { state: "ok"; policy: WatchPolicy; generation: string };

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const policyGeneration = (policy: WatchPolicy): string => createHash("sha256").update(JSON.stringify(canonical(policy))).digest("hex");

export function readWatchPolicy(projectDir: string, file: string): WatchPolicyRead {
  if (!existsSync(file)) return { state: "none" };
  try {
    if (statSync(file).size > 65_536) throw new Error("watch-policy.json is too large");
    const parsed = watchPolicySchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) return { state: "invalid", reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 500) };
    const root = realpathSync(projectDir);
    for (const d of Object.values(parsed.data.directions)) {
      if (!parsed.data.enabled || !d.reply || !d.strategy) continue;
      if (isAbsolute(d.strategy.path) || !d.strategy.path.endsWith(".md")) throw new Error("Strategy must be a project-relative Markdown file");
      const target = realpathSync(resolve(root, d.strategy.path));
      const within = relative(root, target);
      if (within.startsWith("..") || isAbsolute(within) || statSync(target).size > 1_048_576) throw new Error("Strategy must stay inside the project and below 1 MiB");
      if (createHash("sha256").update(readFileSync(target)).digest("hex") !== d.strategy.sha256) throw new Error("Strategy changed: the action grant must be renewed");
    }
    return { state: "ok", policy: parsed.data, generation: policyGeneration(parsed.data) };
  } catch (e) {
    return { state: "invalid", reason: e instanceof Error ? e.message.slice(0, 500) : "Cannot read watch-policy.json" };
  }
}
