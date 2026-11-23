/**
 * `get_message_content` returns every raw header (about 10k chars, ~87% of the reply). The PostToolUse hook swaps
 * `allHeaders` for the lines a triage actually reads. Pure: no I/O. Returns `null` when the reply is not recognisable,
 * so the hook then leaves the original output alone.
 */
const KEEP = new Set([
  // to, cc and x-gm-original-to: the first and last headers of the brand order (P60; `message_show` and `draft_write`); without them a forwarded mail can never match its brand
  "to", "cc", "x-gm-original-to",
  "delivered-to", "x-forwarded-to", "x-original-to", "x-forwarded-for", "reply-to", "return-path", "list-unsubscribe", "list-id",
  "precedence", "auto-submitted", "authentication-results", "received-spf", "message-id", "in-reply-to", "references",
]);
const LINE_CAP = 300;

export function slimHeaders(all: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  // a folded header continues on the next line (leading whitespace)
  const lines = all.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ").split("\n");
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i <= 0) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    if (!KEEP.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(l.length > LINE_CAP ? l.slice(0, LINE_CAP) + "..." : l);
  }
  return out.join("\n");
}

function slimJsonText(text: string): string | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const holder = j && typeof j === "object" ? (typeof (j.message as Record<string, unknown> | undefined)?.allHeaders === "string" ? (j.message as Record<string, unknown>) : typeof j.allHeaders === "string" ? j : null) : null;
    if (!holder) return null;
    holder.allHeaders = slimHeaders(holder.allHeaders as string);
    return JSON.stringify(j);
  } catch { return null; }
}

/** The tool response in its own shape (string, block array, `{content:[...]}`) with slim headers; `null` if nothing changed. */
export function slimMessageContent(resp: unknown): unknown | null {
  if (typeof resp === "string") return slimJsonText(resp);
  if (Array.isArray(resp)) {
    let hit = false;
    const next = resp.map((b) => {
      const t = b && typeof b === "object" ? (b as { text?: unknown }).text : undefined;
      if (typeof t !== "string") return b;
      const s = slimJsonText(t);
      if (s == null) return b;
      hit = true;
      return { ...(b as object), text: s };
    });
    return hit ? next : null;
  }
  if (resp && typeof resp === "object" && Array.isArray((resp as { content?: unknown }).content)) {
    const inner = slimMessageContent((resp as { content: unknown[] }).content);
    return inner == null ? null : { ...(resp as object), content: inner };
  }
  return null;
}
