import { z } from "zod";
import { AUTOPILOT_CHANNELS, AUTOPILOT_DISCLOSE, AUTOPILOT_MODES, AUTOPILOT_OFF_REASONS } from "@hub/config/autopilot";
import { project } from "./requests";

// The autopilot's switches on the wire (decision 0048 point 2, P139 A1): the owner's routes read and write them; the admin (A5)
// draws them. Every write is an owner door (the admin's exact Origin, a loopback Host, `Sec-Fetch-Site: same-origin`) and spends a
// single-use ticket bound to `autopilot:<scope>`, so the agent, which has no tool for them and cannot write their files, cannot
// flip one.

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const quiet = z.strictObject({ from: clock, to: clock, tz: z.string().min(1).max(64) });
const ticket = z.string().min(1).max(200);

/** The instance switch (`state/autopilot.json`). `error`: the file does not parse, so it reads as off. */
export const autopilotInstanceDto = z.strictObject({
  on: z.boolean(),
  updatedAt: z.string().nullable(),
  by: z.string().nullable(),
  error: z.string().nullable(),
});
export type AutopilotInstanceDto = z.infer<typeof autopilotInstanceDto>;

/** A ticket for one autopilot write: the instance switch, or one project's block. */
export const autopilotTicketBody = z.discriminatedUnion("scope", [z.strictObject({ scope: z.literal("instance") }), z.strictObject({ scope: z.literal("project"), project })]);
export type AutopilotTicketBody = z.infer<typeof autopilotTicketBody>;
/** The subject a ticket is bound to: `autopilot:instance` or `autopilot:project:<slug>`. */
export const autopilotScope = (b: AutopilotTicketBody): string => (b.scope === "instance" ? "autopilot:instance" : `autopilot:project:${b.project}`);

export const setAutopilotInstanceBody = z.strictObject({ on: z.boolean(), ticket });
export type SetAutopilotInstanceBody = z.infer<typeof setAutopilotInstanceBody>;

/** One change to a project's block, with its ticket. `chat` is the linked chat's row id (`chat:<id>`); switching it on clears its pause. */
export const setAutopilotProjectBody = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mode"), mode: z.enum(AUTOPILOT_MODES), ticket }),
  z.strictObject({ kind: z.literal("chat"), chat: z.number().int().positive(), on: z.boolean(), ticket }),
  z.strictObject({ kind: z.literal("disclose"), disclose: z.enum(AUTOPILOT_DISCLOSE), ticket }),
  z.strictObject({ kind: z.literal("quiet"), quiet: quiet.nullable(), ticket }),
]);
export type SetAutopilotProjectBody = z.infer<typeof setAutopilotProjectBody>;

/** One linked chat's autopilot, as its three switches, Stop sending, its reply mode and its pause make it. */
export const autopilotChatDto = z.strictObject({
  chat: z.number().int().positive(),
  channel: z.enum(AUTOPILOT_CHANNELS),
  chatId: z.string(),
  title: z.string().nullable(),
  /** In the project's `chats` list (the per-chat switch). */
  listed: z.boolean(),
  state: z.enum(["on", "dry_run", "off", "paused"]),
  off: z.enum(AUTOPILOT_OFF_REASONS).nullable(),
  pausedAt: z.string().nullable(),
  /** A code of `PAUSING_REASONS`, and its words. */
  pausedReason: z.string().nullable(),
  pausedWords: z.string().nullable(),
  /** P139 A6: the newest turn's note (the model's reason for a hand-back, or the door's), when it has one. */
  note: z.string().nullable(),
});
export type AutopilotChatDto = z.infer<typeof autopilotChatDto>;

/** P139 A6: what the turns of the last 24 hours came to, and autopilot's share used per account (verdict 22). */
export const autopilotTodayDto = z.strictObject({
  sent: z.number().int().nonnegative(),
  handedBack: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
  dryRun: z.number().int().nonnegative(),
  lastTurnAt: z.string().nullable(),
  accounts: z.array(z.strictObject({ channel: z.enum(AUTOPILOT_CHANNELS), account: z.string(), used: z.number().int().nonnegative(), share: z.number().int().positive() })),
});
export type AutopilotTodayDto = z.infer<typeof autopilotTodayDto>;

/** A project's block and every linked chat's state. `error`: the send policy does not parse (nothing is written over it). */
export const autopilotProjectDto = z.strictObject({
  project,
  instanceOn: z.boolean(),
  mode: z.enum(AUTOPILOT_MODES),
  disclose: z.enum(AUTOPILOT_DISCLOSE),
  quiet: quiet.nullable(),
  updatedAt: z.string().nullable(),
  error: z.string().nullable(),
  chats: z.array(autopilotChatDto),
  today: autopilotTodayDto,
});
export type AutopilotProjectDto = z.infer<typeof autopilotProjectDto>;
