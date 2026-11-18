import { z } from "zod";

/** Bumped when a response changes shape: the admin shows "restart the server" when its own number is higher. */
export const API_VERSION = 8; // 8: P49 (send ticket, terminal, agent tools)

const messengersStatus = z.object({
  state: z.enum(["off", "starting", "running", "error", "stopped"]),
  reason: z.string().optional(),
  project: z.string().optional(),
  lastPollAt: z.string().optional(),
  lastError: z.string().optional(),
  failures: z.number(),
  stored: z.number(),
});
/**
 * Sent detection (P48 W2): an `osascript` read of each active project's Sent mailbox in Apple Mail, only while a draft waits.
 * `off` with a reason when nothing waits, or Mail is not running (it is never launched for this).
 */
const sentStatus = z.object({
  state: z.enum(["off", "starting", "running", "error", "stopped"]),
  reason: z.string().optional(),
  projects: z.array(z.string()),
  lastRunAt: z.string().optional(),
  lastError: z.string().optional(),
  failures: z.number(),
  marked: z.number(),
});

export const healthDto = z.object({
  ok: z.literal(true),
  apiVersion: z.number(),
  messengers: messengersStatus,
  sent: sentStatus,
  /** Which Mailer the server sends with: `fake` (HUB_MAILER=fake, e2e and demos) never leaves the process. */
  mailer: z.enum(["mail-app", "fake"]),
});
export type HealthDto = z.infer<typeof healthDto>;

/**
 * What the admin polls every 10 s while the tab is visible. `dataVersion` changes when ANY connection commits to the
 * database file (SQLite `PRAGMA data_version`), so a `hub record-draft` run in a terminal is noticed; the lists are
 * refetched only when it changed.
 */
export const pulseDto = z.object({ dataVersion: z.number(), serverTime: z.string(), health: healthDto });
export type PulseDto = z.infer<typeof pulseDto>;
