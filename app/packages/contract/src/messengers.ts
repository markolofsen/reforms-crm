import { z } from "zod";

/**
 * The Telegram user account (P71 M1, decision 0036): its state in `/api/health`, the login steps, the dialog picker and the link.
 * Every reply is a `strictObject` and none has a field for a session, an api_hash, a code or a password, so no value can come
 * back by accident. A dialog's title, username and phone are the owner's own contacts, read on demand for his screen and never
 * stored or logged by the server.
 */

/** A user account's parks (0036 point 2): never retried by itself; a new login clears it. Same words as `@hub/messengers`. */
export const PARKED_CODES = ["logged_out", "banned", "flood_wait"] as const;
export type ParkedCode = (typeof PARKED_CODES)[number];

export const USER_ACCOUNT_STATES = ["starting", "running", "error", "parked", "stopped"] as const;

export const telegramUserAccountDto = z.strictObject({
  /** The signed-in user's Telegram id (the session folder's name): an id, never a secret. */
  account: z.string(),
  state: z.enum(USER_ACCOUNT_STATES),
  parked: z.enum(PARKED_CODES).nullable(),
  /** The one line that clears a park or an error, else null. */
  fix: z.string().nullable(),
  lastPollAt: z.string().optional(),
  lastError: z.string().optional(),
  failures: z.number(),
  stored: z.number(),
});
export type TelegramUserAccountDto = z.infer<typeof telegramUserAccountDto>;

/** `off` with a reason (no session, `HUB_MESSENGERS=off`, several projects); `on` with one row per account. */
export const telegramUserStatusDto = z.strictObject({
  state: z.enum(["off", "on"]),
  reason: z.string().optional(),
  project: z.string().optional(),
  accounts: z.array(telegramUserAccountDto),
});
export type TelegramUserStatusDto = z.infer<typeof telegramUserStatusDto>;

// ---- the login (each step one call; nothing but the final session is kept)

const flow = z.string().min(16).max(64);
export const userLoginStartBody = z.strictObject({
  apiId: z.number().int().positive().max(2 ** 31),
  apiHash: z.string().trim().regex(/^[a-f0-9]{32}$/i, "api_hash is 32 hex characters from my.telegram.org"),
  phone: z.string().trim().regex(/^\+?[\d\s\-().]{7,24}$/, "a phone number in international format"),
});
export const userLoginCodeBody = z.strictObject({ flow, code: z.string().trim().regex(/^[\d\s]{4,12}$/, "the digits Telegram sent") });
export const userLoginPasswordBody = z.strictObject({ flow, password: z.string().min(1).max(256) });
export const userLoginCancelBody = z.strictObject({ flow });
export type UserLoginStartBody = z.infer<typeof userLoginStartBody>;

export const userLoginStepDto = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("code"), flow }),
  z.strictObject({ step: z.literal("password"), flow }),
  /** `name` is the owner's own display name, so he sees which account was connected. */
  z.strictObject({ step: z.literal("done"), account: z.string(), name: z.string() }),
]);
export type UserLoginStepDto = z.infer<typeof userLoginStepDto>;

export const userLoginCancelledDto = z.strictObject({ ok: z.literal(true) });
export const userDisconnectedDto = z.strictObject({ ok: z.literal(true), account: z.string(), removed: z.boolean() });

// ---- the picker and the link (0036 point 3)

export const userDialogsBody = z.strictObject({ clientId: z.number().int().positive() });
export const userDialogDto = z.strictObject({
  chatId: z.string(),
  title: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  /** Its phone or Telegram id equals one of this client's identifiers: a suggestion, which the owner confirms (never auto-linked). */
  suggested: z.boolean(),
  /** Already linked in this project (to this or another client). */
  linked: z.boolean(),
});
export const userDialogsDto = z.strictObject({ dialogs: z.array(userDialogDto) });
export type UserDialogDto = z.infer<typeof userDialogDto>;

export const userLinkBody = z.strictObject({
  clientId: z.number().int().positive(),
  chatId: z.string().regex(/^\d{1,20}$/),
  title: z.string().trim().max(200).optional(),
});
export const userLinkedDto = z.strictObject({
  ok: z.literal(true),
  chatId: z.string(),
  /** Messages of the last 30 days stored by the import. */
  imported: z.number(),
  /** Why the import failed while the link stands (new messages still arrive), else null. */
  importError: z.string().nullable(),
});
export type UserLinkedDto = z.infer<typeof userLinkedDto>;
