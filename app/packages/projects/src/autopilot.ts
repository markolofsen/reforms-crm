// The autopilot's switches (decision 0048 point 2, P139 A1). Three levels, and all must be on:
// - the instance: `state/autopilot.json` `{on}` (`hubPaths().autopilot`), off by default;
// - the project: the `autopilot` block of `state/projects/<slug>/send-policy.json`, mode `off | dry_run | on`, off by default;
// - the chat: its `<channel>:<chatId>` in that block's `chats`.
// Both files are protected paths (`@hub/agent` `protectedPaths`): an agent session cannot write them. The project block is
// written only through `setAutopilot` below, which writes through the send policy's one writer (`writeSendPolicy`); the owner's
// admin route and `hub send policy autopilot` (a person's shell, refused inside a session) are its callers. `app.db` holds only
// what stops autopilot (a chat's pause): a forged row can only stop it, never start it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { AUTOPILOT_DISCLOSE, AUTOPILOT_MODES, type AutopilotDisclose, type AutopilotMode, type AutopilotOff } from "@hub/config/autopilot";
import type { ReplyMode } from "@hub/config/chat-rules";
import { autopilotOff, autopilotPolicySchema, readSendPolicy, writeSendPolicy, type AutopilotPolicy, type SendPolicy } from "./send-policy";

const switchSchema = z.object({ schema: z.literal(1), on: z.boolean(), updatedAt: z.string(), by: z.string().min(1) }).strict();
export type AutopilotSwitch = z.infer<typeof switchSchema>;

export interface SwitchState {
  /** `file`: read; `default`: no file (off). An unreadable file reads as off, with the reason. */
  source: "file" | "default";
  value: AutopilotSwitch;
  error?: string;
}

/** The instance switch. No file, or one that does not parse, is off: the safe reading. */
export function readAutopilotSwitch(file: string): SwitchState {
  const off: AutopilotSwitch = { schema: 1, on: false, updatedAt: "", by: "default" };
  if (!existsSync(file)) return { source: "default", value: off };
  try {
    const r = switchSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return r.success ? { source: "file", value: r.data } : { source: "default", value: off, error: `${file}: ${r.error.issues[0]?.message ?? "invalid"}` };
  } catch (e) {
    return { source: "default", value: off, error: `${file}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Writes the instance switch (temp file, then rename). Its one caller is the owner's admin route. */
export function writeAutopilotSwitch(file: string, on: boolean, by: string, now: Date = new Date()): AutopilotSwitch {
  const value: AutopilotSwitch = { schema: 1, on, updatedAt: now.toISOString(), by };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(switchSchema.parse(value), null, 2) + "\n");
  renameSync(tmp, file);
  return value;
}

/** The project's block as in force: the file's, else off. */
export const autopilotOf = (p: SendPolicy): AutopilotPolicy => p.autopilot ?? autopilotOff();

/** One change to a project's block, as the owner's route and the CLI state it. */
export type AutopilotChange =
  | { kind: "mode"; mode: AutopilotMode }
  | { kind: "chat"; chat: string; on: boolean }
  | { kind: "disclose"; disclose: AutopilotDisclose }
  | { kind: "quiet"; quiet: AutopilotPolicy["quiet"] };

export const isAutopilotMode = (v: unknown): v is AutopilotMode => typeof v === "string" && (AUTOPILOT_MODES as readonly string[]).includes(v);
export const isAutopilotDisclose = (v: unknown): v is AutopilotDisclose => typeof v === "string" && (AUTOPILOT_DISCLOSE as readonly string[]).includes(v);

/** The block after one change (pure). A chat switched on twice is listed once; switched off, it leaves the list. */
export function changeAutopilot(cur: AutopilotPolicy, c: AutopilotChange): AutopilotPolicy {
  switch (c.kind) {
    case "mode":
      return autopilotPolicySchema.parse({ ...cur, mode: c.mode });
    case "chat": {
      const rest = cur.chats.filter((k) => k !== c.chat);
      return autopilotPolicySchema.parse({ ...cur, chats: c.on ? [...rest, c.chat] : rest });
    }
    case "disclose":
      return autopilotPolicySchema.parse({ ...cur, disclose: c.disclose });
    case "quiet":
      return autopilotPolicySchema.parse({ ...cur, quiet: c.quiet });
    default:
      return unreachable(c);
  }
}

function unreachable(c: never): never {
  throw new Error(`unknown autopilot change ${JSON.stringify(c)}`);
}

/**
 * Writes one change to a project's autopilot block through the send policy's one writer, stamped with who and when. Refuses an
 * unreadable policy file (it is never overwritten with defaults). Returns the policy written.
 */
export function setAutopilot(policyDir: string, slug: string, kindId: string, change: AutopilotChange, by: string, now: Date = new Date()): SendPolicy {
  const st = readSendPolicy(policyDir, slug, kindId);
  if (st.error) throw new Error(`the send policy of ${slug} cannot be read, so it is not rewritten: ${st.error}`);
  const next: SendPolicy = { ...st.policy, autopilot: changeAutopilot(autopilotOf(st.policy), change), updatedAt: now.toISOString(), by };
  writeSendPolicy(policyDir, slug, next);
  return next;
}

export type ChatAutopilot =
  | { state: "on" | "dry_run" }
  | { state: "off"; off: AutopilotOff }
  | { state: "paused"; reason: string; at: string };

/**
 * A chat's autopilot (pure): the three switches (decision 0048 point 2), Stop sending, the chat's reply mode (verdict 2: only
 * `draft`), then its pause. The pause is last: a chat that is off says why it is off, not that it is paused.
 */
export function chatAutopilot(o: { instanceOn: boolean; policy: AutopilotPolicy; chat: string; replyMode: ReplyMode; stopped: boolean; paused: { at: string; reason: string } | null }): ChatAutopilot {
  if (!o.instanceOn) return { state: "off", off: "instance" };
  if (o.policy.mode === "off") return { state: "off", off: "project" };
  if (!o.policy.chats.includes(o.chat)) return { state: "off", off: "chat" };
  if (o.stopped) return { state: "off", off: "stopped" };
  if (o.replyMode !== "draft") return { state: "off", off: "reply_mode" };
  if (o.paused) return { state: "paused", reason: o.paused.reason, at: o.paused.at };
  return { state: o.policy.mode };
}

/** The owner's sentence for each switch that is off. */
export const AUTOPILOT_OFF_WORDS: Record<AutopilotOff, string> = {
  instance: "Autopilot is off on this Mac",
  project: "Autopilot is off for this project",
  chat: "Autopilot is off in this chat",
  reply_mode: "Autopilot needs the reply mode Draft replies",
  stopped: "Stop sending is on",
};
