import { redact as redactSecrets } from "@hub/connections";

// What an ops line may keep (P86). The ONE redactor of the ops log: every message and every field of every line passes
// through `redactOps`, and `test/ops-redact.test.ts` enforces it. Two kinds of rule:
// - by name: a field whose key names a secret (a login code, a password, a token, an api_hash, a session) is `***` whatever
//   its value (a Telegram login code is 5 digits, a pairing code is letters: no shape catches them); a field whose key names a
//   body (a message's or a mail's text) is dropped, never masked: a body never reaches the ops log.
// - by shape, in every string: the secrets on disk and token shapes (`@hub/connections`), WhatsApp jids, phone numbers (a run
//   of 6 or more digits, or a `+` number with separators; the `+` stays, so `+[n]` reads as a phone), key-shaped base64 (24 or more characters), emails (`m***@domain`).
// A field named `code` is a secret: an error's code goes in `kind`, an HTTP or close status in `status`.

/** Keys whose value is a secret: masked whatever it holds. Matched on the key's last word (`phone_code`, `apiHash`, `botToken`). */
const SECRET_KEY = /(?:^|[_-])(code|password|passwd|pass|token|hash|session|secret|key|authorization|cookie|qr|otp|pin|credentials?|creds)$/i;
/** Keys whose value is a message or mail body: dropped. */
const BODY_KEY = /^(text|body|content|html|plain|message_?text|caption|snippet|excerpt|quote)$/i;
/** Keys whose number is an identity (a Telegram id, a phone): masked as a string would be. */
const IDENTITY_KEY = /(?:^|[_-])(id|chat|chat_?id|phone|account|user|peer|jid|from|to)$/i;

const JID = /[^\s"'<>=,;()[\]]*@(?:s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter|bot|hosted(?:\.lid)?)\b/gi;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
// Key-shaped: 24 or more base64 characters with a digit or `+`/`/` among them (a long camelCase word is not a key).
const KEYISH = /\b(?=[A-Za-z_-]*[0-9+/])[A-Za-z0-9+/_-]{24,}={0,2}/g;
/** A `+` number with spaces, dots, dashes or brackets (`+7 (999) 123-45-67`), or 6 or more digits with at most single spaces between. */
const PHONE = /(?<=\+)\d(?:[\s().-]{0,2}\d){5,}|\d(?: ?\d){5,}/g;

/** One string of a line: cut, then every shape rule. Exported for the tests and for `whatsapp-log.ts`. */
export function redactText(s: string, max = 1000): string {
  const cut = s.length > max ? `${s.slice(0, max)}… [cut, ${s.length} chars]` : s;
  return cut
    .replace(JID, "[jid]")
    .replace(EMAIL, "$1***@$2")
    .replace(KEYISH, "[key]")
    .replace(PHONE, "[n]");
}

/** The camelCase key as snake words, so `apiHash` and `api_hash` match one rule. */
const words = (k: string): string => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2");

export const isSecretKey = (k: string): boolean => SECRET_KEY.test(words(k));
export const isBodyKey = (k: string): boolean => BODY_KEY.test(words(k));
const isIdentityKey = (k: string): boolean => IDENTITY_KEY.test(words(k));

/** An error as a line keeps it: its name and message, and for an unexpected one the first frames of its stack. */
export function errorFields(e: unknown, stack = false): Record<string, unknown> {
  if (e instanceof Error) {
    const out: Record<string, unknown> = { error: `${e.name}: ${e.message}` };
    const kind: unknown = Reflect.get(e, "code");
    if (typeof kind === "string" || typeof kind === "number") out.kind = kind;
    if (stack && e.stack) out.stack = e.stack.split("\n").slice(1, 6).map((l) => l.trim()).join(" | ");
    return out;
  }
  return { error: typeof e === "string" ? e : JSON.stringify(e) ?? String(e) };
}

/** One field value, walked: strings redacted, identity numbers masked, objects and arrays capped. */
function value(key: string, v: unknown, depth: number): unknown {
  if (v === null || v === undefined || typeof v === "boolean") return v ?? null;
  if (isSecretKey(key)) return "***";
  if (typeof v === "string") return redactText(v);
  if (typeof v === "number") return isIdentityKey(key) && String(Math.trunc(Math.abs(v))).length >= 6 ? "[n]" : v;
  if (typeof v === "bigint") return "[n]";
  if (v instanceof Error) return redactFields(errorFields(v), depth + 1);
  if (depth >= 4) return "[deep]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => value(key, x, depth + 1));
  if (typeof v === "object") return redactFields(v as Record<string, unknown>, depth + 1);
  return null;
}

/** Every field of a line: body keys dropped, secret keys masked, the rest walked. */
export function redactFields(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields).slice(0, 40)) {
    if (isBodyKey(k)) {
      out[k] = "[body omitted]";
      continue;
    }
    out[k] = value(k, v, depth);
  }
  return out;
}

/**
 * The whole line's message and fields as the ops log keeps them. With `secretsDir`, every value stored under `state/secrets`
 * is masked too (one read of the folder per line, after the shapes, on the serialised fields: a replacement only lands inside
 * a JSON string, and if the text no longer parses the fields are dropped rather than kept half-redacted).
 */
export function redactOps(message: string, fields: Record<string, unknown> | undefined, secretsDir?: string): { message: string; fields?: Record<string, unknown> } {
  // Without an instance the folder is missing: the token shapes and the Bearer rule still apply.
  const dir = secretsDir ?? NO_SECRETS;
  let m = redactText(message, 500);
  let f = fields && Object.keys(fields).length ? redactFields(fields) : undefined;
  try {
    m = redactSecrets(dir, m);
    if (f) {
      const back: unknown = JSON.parse(redactSecrets(dir, JSON.stringify(f)));
      f = back && typeof back === "object" && !Array.isArray(back) ? (back as Record<string, unknown>) : { redacted: true };
    }
  } catch {
    f = f ? { redacted: true } : undefined;
  }
  return f ? { message: m, fields: f } : { message: m };
}

/** A folder that never exists: the secrets redactor then knows no stored value and applies its shapes only. */
const NO_SECRETS = "/nonexistent/hub-ops-no-secrets";
