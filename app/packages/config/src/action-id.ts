// P137 L1: one action id end to end. The owner's click (the admin's `x-hub-action` header), the server request it starts, the
// agent session and its `hub mcp` tool calls (`HUB_ACTION`), and the Notion, Mail and send writes they make share one id, so the
// ops log and the session log can be read as one action instead of by time. Browser-safe: the admin's mutator and the server read
// the same header name and the same shape. An id is short and plain (no digit run, no key shape), so no redactor rule touches it.

/** The header the admin sends with a write, and the server answers with (its own id when the request had none). */
export const ACTION_HEADER = "x-hub-action";
/** The env var a spawned session (`hub agent`, its hooks and `hub mcp`) carries the id in. */
export const ACTION_ENV = "HUB_ACTION";

const SHAPE = /^[a-z]{1,3}-[a-z]{4,24}(?:\.[a-z]{2,12})?$/;

/** True for an id this module made (`w-kqzhtrvmab`, a tool call's `w-kqzhtrvmab.fjdkq`); anything else is replaced, never trusted. */
export const isActionId = (v: unknown): v is string => typeof v === "string" && v.length <= 48 && SHAPE.test(v);

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const letters = (n: number, bytes: Uint8Array): string => Array.from(bytes.slice(0, n), (b) => LETTERS[b % 26]).join("");

/**
 * A fresh id: who started it (`w` the admin's write, `r` a server request without one, `s` an agent session, `t` a timer or a
 * pass, `c` the CLI), then ten letters (26^10, enough for a day of one owner's actions). Letters only: a digit run would read as
 * a phone number to the ops redactor.
 */
export function newActionId(prefix: "w" | "r" | "s" | "t" | "c" = "r"): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${letters(10, bytes)}`;
}

/** The id of one tool call inside a session's action: the session's id and five letters derived from the call's own id. */
export function toolActionOf(base: string, callId: string | undefined): string {
  if (!callId) return base;
  let h = 2166136261;
  for (let i = 0; i < callId.length; i++) h = Math.imul(h ^ callId.charCodeAt(i), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += LETTERS[h % 26];
    h = Math.floor(h / 26);
  }
  return `${baseActionOf(base)}.${out}`;
}

/** The session's base id of a tool call's id (`w-abc.fjdkq` → `w-abc`). */
export const baseActionOf = (id: string): string => id.split(".")[0] ?? id;
