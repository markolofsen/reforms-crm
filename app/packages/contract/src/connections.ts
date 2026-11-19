import { z } from "zod";

/**
 * The Connections panel (P37, P48): the instance's Notion token and Telegram bot, and the projects' mail accounts as Apple
 * Mail knows them. Mail has no key in the Hub (decision 0026): it is read and sent only through Apple Mail, so its rows are
 * read-only. Every schema is a `strictObject` and none has a field for a secret value, so a value cannot be added by
 * accident: it would fail the parse on the server. What a client may send to write a secret is in `requests.ts`; nothing
 * here ever carries one back.
 */

/** Closed lists; `@hub/connections` holds the same words for the server and CLI (the admin may not import it). A mismatch fails the server's type check. */
export const CONNECTION_KINDS = ["notion", "telegram"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const SECRET_STATES = ["stored", "missing", "unsafe-mode", "malformed", "from-env"] as const;
export type SecretState = (typeof SECRET_STATES)[number];
export const CONNECTION_ACTIONS = ["test", "set", "remove"] as const;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[number];

/** A test result is `fresh` for this long, then `stale`. A server restart empties it (`never`). Minutes. */
export const CONNECTION_FRESH_MINUTES = 60;

/** Why a test failed, in terms of what to fix. The provider's own text is never carried. */
export const CHECK_ERROR_CODES = ["token-missing", "token-rejected", "timeout", "unreachable", "failed"] as const;
export type CheckErrorCode = (typeof CHECK_ERROR_CODES)[number];

/** What a test learned, as a sentence and the provider's public name for the key. Never a value and never the provider's own text. */
export const checkValueDto = z.strictObject({ detail: z.string(), identity: z.string().nullable() });
export type CheckValueDto = z.infer<typeof checkValueDto>;

const stamp = z.string();
/** The last test of a connection, with its state. `value` is kept with `stale` and `error` (the last good result) and absent with `never`. */
export const checkBlock = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("fresh"), asOf: stamp, value: checkValueDto }),
  z.strictObject({ state: z.literal("stale"), asOf: stamp, value: checkValueDto }),
  z.strictObject({ state: z.literal("never") }),
  z.strictObject({ state: z.literal("refreshing"), asOf: stamp.optional(), value: checkValueDto.optional() }),
  z.strictObject({ state: z.literal("error"), code: z.enum(CHECK_ERROR_CODES), message: z.string(), fix: z.string(), asOf: stamp.optional(), value: checkValueDto.optional() }),
]);
export type CheckBlock = z.infer<typeof checkBlock>;

export const connectionDto = z.strictObject({
  /** `notion:<file>`, `telegram:bot`: the only thing a client sends back to pick a connection. */
  id: z.string(),
  kind: z.enum(CONNECTION_KINDS),
  label: z.string(),
  secret: z.strictObject({ state: z.enum(SECRET_STATES), changedAt: z.string().optional() }),
  /** A public fact about the key (`@botname`, the Notion bot). */
  identity: z.string().nullable(),
  usedBy: z.array(z.string()),
  can: z.array(z.enum(CONNECTION_ACTIONS)),
  note: z.string().optional(),
  check: checkBlock,
});
export type ConnectionDto = z.infer<typeof connectionDto>;

/**
 * One mail account a project lists under `mail.accounts`, read-only. `foundInMail`: Apple Mail has an account with that
 * name or address (`true` / `false`), or Mail could not be asked (`null`, never a guess; `mailRead` says why).
 */
export const mailAccountDto = z.strictObject({
  account: z.string(),
  foundInMail: z.boolean().nullable(),
  usedBy: z.array(z.string()),
});
export type MailAccountDto = z.infer<typeof mailAccountDto>;

/**
 * How the one read of Mail's accounts went: `answered`; `not-running` (Mail is closed and is never started for this); or
 * `not-answering` (Mail runs but held the AppleEvent past its budget, measured 2026-11-19), with the fix line. Either way
 * the rows say `foundInMail: null` and the rest of the page renders.
 */
export const MAIL_READ_STATES = ["answered", "not-running", "not-answering"] as const;
export const mailReadDto = z.strictObject({
  state: z.enum(MAIL_READ_STATES),
  fix: z.string().nullable(),
});
export type MailReadDto = z.infer<typeof mailReadDto>;

export const connectionsDto = z.strictObject({
  /** The instance folder's name (a name, not a path). */
  instance: z.string(),
  connections: z.array(connectionDto),
  mail: z.array(mailAccountDto),
  mailRead: mailReadDto,
});
export type ConnectionsDto = z.infer<typeof connectionsDto>;
