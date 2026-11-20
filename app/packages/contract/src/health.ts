import { z } from "zod";
import { telegramUserStatusDto, whatsappStatusDto } from "./messengers";

/** Bumped when a response changes shape: the admin shows "restart the server" when its own number is higher. */
export const API_VERSION = 38; // 9: P50 (GET /api/live); 10: P53 (live topic `mail`, `note` on a draft's Mail read); 11: P56 (`aside`, `gone`, `checkedCurrent`, Save and Restore); 12: P57 (`clis`, `checkedAt`, `POST /api/terminal/ensure`); 13: P59 (live topic `agent-log`, `GET /api/projects/:slug/agent-feed`); 14: P60 (`wroteTo`, `brand` on a draft; doctor outcome `warn`); 15: P61 (`localOpen` on the instance, `POST /api/local/:action`); 16: P66 (the terminal state is one object: no `enabled`, `problem`; a start answers 503 `terminal_unavailable` with `fix`); 17: P67 (`GET`/`POST /api/instance/autostart`, live topic `autostart`); 18: P68 (`GET /api/instance/core`, `POST /api/instance/core/check`, live topic `core`); 19: P63 (`next` may name `knowledge`, `setup`, `agents`; `GET /api/scheme`); 20: P70 (`next` and a part's `place` name `overview`, `knowledge`, `sending`, `mail`, `agent`, `connections`, `mac`; the doctor facts carry `autosend`; `GET /api/projects/:slug/knowledge`); 21: P70 UX pass (scheme part `session`; `local` on the core update); 22: P58 R1 (`messageId` on a draft's Mail read: Open draft in Mail); 23: P55 (`GET`/`PUT /api/agent-settings`: the model and the advisor); 24: P62 (`capabilities` on the agent tools: the project's attached connectors); 25: P63 patch B (scheme parts `calendar` and `drive`: a project's Google connectors with their account); 26: P65 S4 (safety kind `marker_left` removed); 27: P71 M1 (`telegramUser` in health; the Telegram user account routes); 28: P72 (the focus post is route, title and refs, `schema: 2`; `GET /api/pointer`, live topic `pointer`); 29: P81 (`GET /api/scheme` is `{ nodes }`: no `edges`, the drawing's links are the fixed model of `@hub/contract/scheme-model`); 30: P73 (`GET /api/activity` is one timeline `{ rows, counts, next, client }` by `view`, `client`, `before`: no sessions; the agent feed has no `rows` or `cursor`); 31: P71 M3 (the Messengers routes `/api/projects/:slug/messengers/*`; `next` and a part's `place` may name `messengers`); 32: P71 M4 (the messenger send door `POST /api/projects/:slug/messengers/drafts/:id/send`, `kind` on a send ticket, `channel` and `messengerDraftId` on a send row); 33: P71 M5 (`whatsapp` in health; the WhatsApp routes `/api/messengers/whatsapp/*` and `/api/projects/:slug/messengers/whatsapp/*`; scheme kind `whatsapp`); 34: P87 (scheme part `mail-app` and a part's `action`; Activity rows carry `key`, outcome `sent`, cursor `<at>|<key>`; `sendState.via`, `doneAt` and `otherDrafts` on a draft; `POST /api/batches/:id/acknowledge-warnings`; local action `mail.openApp`); 35: P86 (`GET /api/ops/errors`, live topic `ops-log`); 36: P71 M-P (`triage` on a messenger chat, `hidden` on its newest message, `preanalysis` on the chats reply); 37: P90 (`repliedElsewhere` and `teamSent` on a draft); 38: P96 (`inbound` in health, the Mail reader; `wrote` and `mailRead` in a status's numbers; the Inbox routes `/api/projects/:slug/inbound*`; draft views `inbox` and `sent`; the admin's Drafts became Mail at `/mail`)

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
 * A draft is marked only by its own recorded Message-IDs; a reply in its thread that is not the Hub's is noted on it (P90).
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

/**
 * The Mail reader (P96): an `osascript` read of each active project's inbound mailboxes, read-only, every 2 minutes while the
 * admin is open or a session runs (else every 15). Per project: when its mail was last read, and how many messages of the window
 * came from people the Hub does not know. `off` with a reason when Mail is not running (never launched) or under the fake Mailer.
 */
export const inboundStatusDto = z.object({
  state: z.enum(["off", "starting", "running", "error", "stopped"]),
  reason: z.string().optional(),
  projects: z.array(z.object({ slug: z.string(), readAt: z.string().nullable(), unknown: z.number().int(), error: z.string().optional() })),
  lastRunAt: z.string().optional(),
  lastError: z.string().optional(),
  failures: z.number(),
  stored: z.number(),
  reading: z.boolean(),
});
export type InboundStatusDto = z.infer<typeof inboundStatusDto>;

export const healthDto = z.object({
  ok: z.literal(true),
  apiVersion: z.number(),
  messengers: messengersStatus,
  /** P71: the Telegram user accounts (the owner's own account over MTProto), one row per session. */
  telegramUser: telegramUserStatusDto,
  /** P71 M5: WhatsApp linked devices (the owner's own number, linked by QR code), one row per session. */
  whatsapp: whatsappStatusDto,
  sent: sentStatus,
  inbound: inboundStatusDto,
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
