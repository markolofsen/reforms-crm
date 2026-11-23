import { ops } from "@hub/log/ops";
import { MAIL_SLOW_TEXT } from "./text";
import { DraftWriteError, type InboundMessage, type ReplyDraftResult, type ThreadMailDraft } from "./types";

// The separators the Mail scripts print between fields, lines, records and parts, and the parsers of their output.
export const FS = "\x1f";
export const LS = "\x1d";
export const RS = "\x1e";
export const PS = "\x1c";

export function parseInboundOutput(out: string): InboundMessage | null {
  const p = out.replace(/[\r\n]+$/, "").split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
  if (p[0] !== "ok" || p.length < 4) return null;
  const id = Number(p[3]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const addresses = (p[4] ?? "").split(LS).map((x) => x.trim()).filter(Boolean);
  return { account: p[1] as string, mailboxPath: [p[2] as string], messageId: id, ...(p.length > 4 ? { accountAddresses: addresses } : {}) };
}

export function parseWriteOutput(out: string): ReplyDraftResult {
  const t = out.replace(/[\r\n]+$/, "");
  const p = t.split(FS);
  if (p[0] === "error") {
    // P83: a refused reply Mail kept in Drafts was this run's own and went to Trash; its Mail ids are said, never asked of anyone.
    const cleared = [...new Set((p[3] ?? "").split(LS).map((x) => x.trim()).filter(Boolean))];
    const note = cleared.length ? ` Mail kept the refused reply in Drafts; the Hub moved it to Trash (Mail id ${cleared.join(", ")}).` : "";
    ops("mail").error("Mail refused a draft write", { kind: p[1] || "mail_error", reason: (p[2] || "no reason given").slice(0, 300) });
    throw new DraftWriteError(p[1] || "mail_error", `${p[2] || "Mail refused the draft."}${note}`);
  }
  if (p[0] === "pending") throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT, p.slice(1).join(FS));
  if (p[0] !== "ok" || p.length < 12) {
    ops("mail").error("Mail's answer to a draft write could not be read", { fields: p.length, head: (p[0] ?? "").slice(0, 20) });
    throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
  }
  const [, id, subject, thread, from, replaced, left, mid, savedIn, , shell] = p as [string, string, string, string, string, string, string, string, string, string, string];
  const text = p.slice(11).join(FS);
  const ids = (v: string) => [...new Set(v.split(LS).map((x) => x.trim().replace(/^<|>$/g, "")).filter(Boolean))];
  const messageId = mid.trim().replace(/^<|>$/g, "");
  if (!messageId) throw new DraftWriteError("mail_error", "Mail saved the draft but gave it no Message-ID; nothing was replaced.");
  return { draftId: Number(id), messageId, text, subject, thread: thread.trim().replace(/^<|>$/g, ""), from, replaced: ids(replaced), left: ids(left), savedIn: savedIn.trim(), shell };
}

export function parseThreadDrafts(out: string): ThreadMailDraft[] {
  const t = out.replace(/[\r\n]+$/, "");
  if (t.startsWith(`error${FS}`)) {
    const [, code = "mail_error", message = "Mail refused the read."] = t.split(FS);
    throw new DraftWriteError(code, message);
  }
  const list: ThreadMailDraft[] = [];
  for (const rec of t.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 4) continue;
    const [ref, mid, account] = p as [string, string, string];
    list.push({ ref: ref.trim(), messageId: mid.trim().replace(/^<|>$/g, "") || null, account: account || null, body: p.slice(3).join(FS) });
  }
  return list;
}
