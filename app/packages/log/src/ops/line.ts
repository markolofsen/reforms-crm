// The ops log's line (P86): one JSON object per line. Browser-safe (no node imports): the contract and the admin may read the
// level and source lists from here.

export const OPS_LEVELS = ["error", "warn", "info", "debug"] as const;
export type OpsLevel = (typeof OPS_LEVELS)[number];
export const LEVEL_RANK: Record<OpsLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export const isOpsLevel = (v: unknown): v is OpsLevel => typeof v === "string" && (OPS_LEVELS as readonly string[]).includes(v);

/**
 * Who wrote a line: the part of the Hub it is about, not the file. A closed list, so the CLI's `--source` and Overview's link
 * to the place that fixes it stay exhaustive.
 */
export const OPS_SOURCES = [
  "server", // the API process: start, stop, HTTP 500s, unhandled errors
  "whatsapp",
  "telegram", // the owner's Telegram account (MTProto)
  "telegram_bot",
  "autolink",
  "mail", // Apple Mail: the draft writer, Sent detection, Trash moves
  "notion",
  "send", // the send door: refusals and failures of a person's Send, a batch run
  "agent", // agent sessions, their tools and hooks
  "terminal",
  "knowledge",
  "db", // migrations, the retention purge
  "core", // the core update check
] as const;
export type OpsSource = (typeof OPS_SOURCES)[number];
export const isOpsSource = (v: unknown): v is OpsSource => typeof v === "string" && (OPS_SOURCES as readonly string[]).includes(v);

export interface OpsLine {
  /** ISO time, UTC. */
  time: string;
  level: OpsLevel;
  source: OpsSource;
  message: string;
  /** Structured detail, redacted (`redactOps`); never a message or mail body. */
  fields?: Record<string, unknown>;
}
