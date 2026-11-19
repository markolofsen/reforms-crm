import { z } from "zod";

/** Bumped when a response changes shape: the admin shows "restart the server" when its own number is higher. */
export const API_VERSION = 23; // 9: P50 (GET /api/live); 10: P53 (live topic `mail`, `note` on a draft's Mail read); 11: P56 (`aside`, `gone`, `checkedCurrent`, Save and Restore); 12: P57 (`clis`, `checkedAt`, `POST /api/terminal/ensure`); 13: P59 (live topic `agent-log`, `GET /api/projects/:slug/agent-feed`); 14: P60 (`wroteTo`, `brand` on a draft; doctor outcome `warn`); 15: P61 (`localOpen` on the instance, `POST /api/local/:action`); 16: P66 (the terminal state is one object: no `enabled`, `problem`; a start answers 503 `terminal_unavailable` with `fix`); 17: P67 (`GET`/`POST /api/instance/autostart`, live topic `autostart`); 18: P68 (`GET /api/instance/core`, `POST /api/instance/core/check`, live topic `core`); 19: P63 (`next` may name `knowledge`, `setup`, `agents`; `GET /api/scheme`); 20: P70 (`next` and a part's `place` name `overview`, `knowledge`, `sending`, `mail`, `agent`, `connections`, `mac`; the doctor facts carry `autosend`; `GET /api/projects/:slug/knowledge`); 21: P70 UX pass (scheme part `session`; `local` on the core update); 22: P58 R1 (`messageId` on a draft's Mail read: Open draft in Mail); 23: P55 (`GET`/`PUT /api/agent-settings`: the model and the advisor)

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
