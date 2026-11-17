/** The closed list of connection kinds, each with a label (a total map: adding a kind fails the build until it has one). */
export const CONNECTION_KINDS = ["notion", "mail", "telegram"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const KIND_LABEL: Record<ConnectionKind, string> = {
  notion: "Notion integration",
  mail: "Mail login (IMAP, read only)",
  telegram: "Telegram bot",
};

/** The two token files. Mail logins are `mail-<name>.json` (see `@hub/mail/imap` CREDS_FILE). */
export const NOTION_FILE = "notion-token";
export const TELEGRAM_FILE = "telegram-bot-token";

/** A file name that cannot leave the secrets folder. */
export const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The one Telegram bot token shape: `<bot id>:<secret>`. Every reader and redactor in the hub uses this, nobody keeps a copy. */
export const TELEGRAM_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
/** The same shape found inside a text (an error, a URL), global; for redaction only. */
export const TELEGRAM_IN_TEXT = /\d{5,}:[A-Za-z0-9_-]{20,}/g;
export const isTelegramToken = (v: string): boolean => TELEGRAM_SHAPE.test(v);

/** Why a Notion token cannot be one, or undefined. A shape check only: Notion decides whether it works. */
export const notionShapeProblem = (v: string): string | undefined =>
  /\s/.test(v) || v.length < 16 ? "that does not look like a token (no spaces, at least 16 characters)" : undefined;

/** `Work Gmail` becomes `work-gmail`: the part of `mail-<slug>.json` and of the connection id. Never empty. */
export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "") || "account";
