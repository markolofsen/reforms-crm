import type { Repos } from "@hub/db";
import type { Mailer } from "@hub/send/mailer";
import { ops } from "@hub/log/ops";

// P147 3m item 1: an inbound message to Mail's Junk, then out of Needs you with an Activity line. The one path for the review
// click (a mail pass's junk proposal) and the owner's attended session (`mail_junk`). Junk is recoverable in Mail, like Trash:
// not a deletion. Mail first: a message Mail did not move stays in Needs you, and the answer says why.

const log = ops("lead-pass");

export type JunkResult = { ok: true; closed: number[] } | { ok: false; code: "not_found" | "wrong_state" | "unavailable"; error: string };

export async function junkInbound(o: { repos: Repos; mailer: Pick<Mailer, "moveToJunk"> }, project: string, inboundId: number, by: "review" | "attended", at: Date): Promise<JunkResult> {
  const row = await o.repos.inboundMail.get(project, inboundId);
  if (!row) return { ok: false, code: "not_found", error: `No inbound message ${inboundId} in project ${project}.` };
  if (row.dismissedAt !== null) return { ok: false, code: "wrong_state", error: `Message ${inboundId} has left Needs you already.` };
  let moved: Awaited<ReturnType<Mailer["moveToJunk"]>>;
  try {
    moved = await o.mailer.moveToJunk({ account: row.account, mailbox: row.mailbox, messageId: row.messageId });
  } catch (e) {
    moved = { moved: false, why: e instanceof Error ? e.message.slice(0, 200) : "Mail did not answer" };
  }
  if (!moved.moved) {
    log.warn("mail not moved to Junk", { project, inbound: inboundId, by, why: moved.why });
    return { ok: false, code: "unavailable", error: `Mail did not move it: ${moved.why}. It stays in Needs you.` };
  }
  const closed = await o.repos.mailPass.junked({ project, inboundId, by, at: at.toISOString() });
  log.info("mail moved to Junk", { project, inbound: inboundId, by, closed: closed.length });
  return { ok: true, closed };
}
