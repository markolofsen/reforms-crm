import { createHash } from "node:crypto";
import { redact } from "@hub/connections";

// What the log may keep (P54 section 3, points 10 and 11). The body of a mail lives in Mail (decision 0013): a mail tool's
// body is kept as a hash and a length only. Secrets: the whole event data goes through the one redactor of
// `@hub/connections` (every value under state/secrets plus token shapes). Long texts are cut so a line stays small.

/** The owner's prompt and the agent's answer: kept in full up to this many characters. */
export const TEXT_CAP = 8_000;
/** Any other string inside a tool's input or result. */
export const FIELD_CAP = 2_000;
/** A whole line; above it the envelope stays and `data` says how big it was. */
export const LINE_CAP = 16_384;

/** mail-mcp tools that return headers only (accounts, mailboxes, a search's subjects and senders): their results are kept. */
const MAIL_HEADER_TOOLS = new Set(["list_accounts", "list_mailboxes", "find_messages"]);
/** Input fields that carry a mail body in a compose or draft tool. */
const BODY_FIELDS = new Set(["content", "body", "html", "text", "plain"]);

const MAIL_PREFIX = "mcp__mail-mcp__";
/** Tools whose input carries a mail body: the hub's draft writer and mail-mcp's compose tools (denied, but named). */
const isBodyInputTool = (tool: string): boolean => tool === "mcp__hub__draft_write" || tool.startsWith(MAIL_PREFIX);
/** Tools whose result is mail text. */
export const isMailBodyResult = (tool: string): boolean => tool.startsWith(MAIL_PREFIX) && !MAIL_HEADER_TOOLS.has(tool.slice(MAIL_PREFIX.length));

export interface Hashed { sha256: string; chars: number }
export const hashed = (text: string): Hashed => ({ sha256: createHash("sha256").update(text).digest("hex"), chars: text.length });

const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v) ?? "");

export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}… [cut, ${s.length} chars]` : s);

/** Every string inside a value, cut to `n` characters. */
export function capStrings(v: unknown, n: number = FIELD_CAP, depth = 0): unknown {
  if (typeof v === "string") return cut(v, n);
  if (depth > 8) return "[deep]";
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => capStrings(x, n, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, capStrings(x, n, depth + 1)]));
  return v;
}

/** A tool's input as the log keeps it: a mail body field hashed, other strings capped. */
export function toolInput(tool: string, input: unknown): unknown {
  if (!isBodyInputTool(tool) || !input || typeof input !== "object" || Array.isArray(input)) return capStrings(input);
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, BODY_FIELDS.has(k) && typeof v === "string" ? { body: hashed(v) } : capStrings(v)]));
}

/** A tool's result as the log keeps it: mail text hashed, anything else an excerpt. */
export function toolOutput(tool: string, output: unknown): unknown {
  if (output === undefined || output === null) return null;
  if (isMailBodyResult(tool)) return { body: hashed(asText(output)) };
  return cut(asText(output), FIELD_CAP);
}

/**
 * Redacts the serialised data once (one read of the secrets folder per event, not per string) and parses it back. A
 * replacement only ever lands inside a JSON string, so the text stays JSON; if it does not, the redacted text is kept as one field.
 */
export function redactData(secretsDir: string, data: Record<string, unknown>): Record<string, unknown> {
  const text = redact(secretsDir, JSON.stringify(data));
  try {
    const back: unknown = JSON.parse(text);
    return back && typeof back === "object" && !Array.isArray(back) ? Object.fromEntries(Object.entries(back)) : { redacted: text };
  } catch {
    return { redacted: text };
  }
}
