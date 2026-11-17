import { z } from "zod";
import { liveBlock } from "./overview";

/**
 * The Connections panel (P37): the instance's mail logins, Notion token and Telegram bot. Every schema is a `strictObject` and none has a
 * field for a secret value, so a value cannot be added by accident: it would fail the parse on the server. What a client may send to
 * write a secret is in `requests.ts`; nothing here ever carries one back.
 */

/** Closed lists; `@hub/connections` holds the same words for the server and CLI (the admin may not import it). A mismatch fails the server's type check. */
export const CONNECTION_KINDS = ["notion", "mail", "telegram", "whatsapp"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const SECRET_STATES = ["stored", "missing", "unsafe-mode", "malformed", "from-env", "not-applicable"] as const;
export type SecretState = (typeof SECRET_STATES)[number];
export const CONNECTION_ACTIONS = ["test", "set", "remove"] as const;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[number];

/** A test result is `fresh` for this long, then `stale`. A server restart empties it (`never`). Minutes. */
export const CONNECTION_FRESH_MINUTES = 60;

/** What a test learned, as a sentence and the provider's public name for the key. Never a value and never the provider's own text. */
export const checkValueDto = z.strictObject({ detail: z.string(), identity: z.string().nullable() });
export type CheckValueDto = z.infer<typeof checkValueDto>;

export const connectionDto = z.strictObject({
  /** `notion:<file>`, `mail:<slug>`, `telegram:bot`, `whatsapp`: the only thing a client sends back to pick a connection. */
  id: z.string(),
  kind: z.enum(CONNECTION_KINDS),
  label: z.string(),
  secret: z.strictObject({ state: z.enum(SECRET_STATES), changedAt: z.string().optional() }),
  /** A public fact about the key (the IMAP user and host, `@botname`, the Notion bot). */
  identity: z.string().nullable(),
  usedBy: z.array(z.string()),
  can: z.array(z.enum(CONNECTION_ACTIONS)),
  note: z.string().optional(),
  check: liveBlock(checkValueDto),
});
export type ConnectionDto = z.infer<typeof connectionDto>;

export const connectionsDto = z.strictObject({
  /** The instance folder's name (a name, not a path). */
  instance: z.string(),
  connections: z.array(connectionDto),
});
export type ConnectionsDto = z.infer<typeof connectionsDto>;
