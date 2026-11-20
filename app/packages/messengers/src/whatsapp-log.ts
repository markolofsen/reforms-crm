import { ops, redactText } from "@hub/log/ops";

/**
 * What of Baileys reaches the ops log (P71 M5 fix, P86): its `warn` and `error` lines, and the full reason of every close, as
 * lines of source `whatsapp`. This file never imports Baileys, so the tests run it on plain objects.
 *
 * Privacy (decision 0036 point 3): a line carries Baileys' own message and the tag and attributes of a WhatsApp node only. The
 * ops log's one redactor (`redactText` of `@hub/log/ops`) masks a jid, a phone number, an email and anything key-shaped; an
 * object that is not a node or an error is named, not printed; a message text never reaches a logger call of Baileys at `warn`
 * or above.
 */

const MAX = 300;
const redactWaText = (s: string): string => redactText(s, MAX).slice(0, MAX);

const isNode = (v: unknown): v is { tag: string; attrs?: Record<string, unknown>; content?: unknown } =>
  typeof v === "object" && v !== null && typeof Reflect.get(v, "tag") === "string";

/** A WhatsApp binary node as `tag k=v ...` and its children's tags with their attributes: never its bytes. */
export function nodeLine(n: unknown, depth = 0): string {
  if (!isNode(n)) return "";
  const attrs = Object.entries(n.attrs ?? {})
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${String(v)}`);
  const kids = depth < 1 && Array.isArray(n.content) ? n.content.map((c) => nodeLine(c, depth + 1)).filter(Boolean) : [];
  return [n.tag, ...attrs, ...(kids.length ? [`[${kids.join("; ")}]`] : [])].join(" ");
}

/** One value of a Baileys log object, safe to print: scalars, nodes, errors; any other object by its keys only. */
function valueLine(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (isNode(v)) return `<${nodeLine(v)}>`;
  if (typeof v === "object") {
    const keys = Object.keys(v).slice(0, 6);
    return keys.length ? `{${keys.join(",")}}` : null;
  }
  return null;
}

/** A Baileys log call (`logger.warn(obj, msg)`) as one redacted line. */
export function logLine(obj: unknown, msg?: string): string {
  const parts: string[] = [];
  if (msg) parts.push(msg);
  if (typeof obj === "string") parts.push(obj);
  else if (obj instanceof Error) parts.push(valueLine(obj) ?? "");
  else if (typeof obj === "object" && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      // `trace` is a stack, `xml` a whole frame: neither says why.
      if (k === "trace" || k === "xml" || k === "msg") continue;
      const line = valueLine(v);
      if (line) parts.push(`${k}=${line}`);
    }
  }
  return redactWaText(parts.filter(Boolean).join(" "));
}

export interface WaLogger {
  level: string;
  child(obj: Record<string, unknown>): WaLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export type WaLogWrite = (level: "warn" | "error", line: string) => void;
const toOps: WaLogWrite = (level, line) => ops("whatsapp")[level](`baileys: ${line}`);

/** Baileys' logger at `warn`: `warn` and `error` become redacted ops lines (through `write` in tests); trace, debug and info are dropped. */
export function waLogger(write: WaLogWrite = toOps): WaLogger {
  const noop = () => undefined;
  const out = (level: "warn" | "error") => (obj: unknown, msg?: string) => {
    try {
      write(level, logLine(obj, msg));
    } catch {
      // A log line never breaks the socket.
    }
  };
  const logger: WaLogger = { level: "warn", child: () => logger, trace: noop, debug: noop, info: noop, warn: out("warn"), error: out("error") };
  return logger;
}

/**
 * Why a socket closed, from Baileys' `lastDisconnect.error` (a Boom): its message (`Stream Errored (conflict)`, `Connection
 * Failure`, ...) and its `data`: the `<stream:error>` child node (`conflict type=device_removed`) or a `<failure>`'s attributes
 * (`reason=401 location=...`). Redacted; null when the error says nothing.
 */
export function disconnectDetail(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const parts: string[] = [];
  const message: unknown = Reflect.get(err, "message");
  if (typeof message === "string" && message) parts.push(message);
  const data: unknown = Reflect.get(err, "data");
  if (isNode(data)) parts.push(nodeLine(data));
  else if (typeof data === "object" && data !== null) {
    const attrs = Object.entries(data)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `${k}=${String(v)}`);
    if (attrs.length) parts.push(attrs.join(" "));
  }
  const line = redactWaText(parts.join(": "));
  return line || null;
}
