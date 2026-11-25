import type { Repos } from "@hub/db";
import type { Mailer } from "@hub/send/mailer";
import { ops } from "@hub/log/ops";

// P147 3m item 1 and 3n: one inbound message to Mail's Junk (phishing, junk) or Trash (anything else the owner does not want),
// then out of Needs you with an Activity line. The one path for the owner's buttons (the pane's Spam and Delete, the list's
// selection), the review click (a mail pass's junk proposal) and the owner's attended session (`mail_junk`). Both are
// recoverable in Mail: never a deletion. Mail first: a message Mail did not move stays in Needs you, and the answer says why.
// The agent's call (`attended`) is refused for someone we know (N4); the owner's own clicks never are.

const log = ops("lead-pass");

export type MoveTo = "junk" | "trash";
export type MoveResult = { ok: true; closed: number[] } | { ok: false; code: "not_found" | "wrong_state" | "unavailable" | "refused"; error: string };

const BOX: Record<MoveTo, string> = { junk: "Junk", trash: "Trash" };

export async function moveInbound(o: { repos: Repos; mailer: Pick<Mailer, "moveToJunk" | "moveToTrash"> }, project: string, inboundId: number, m: { to: MoveTo; by: "review" | "attended" | "owner"; at: Date }): Promise<MoveResult> {
  const row = await o.repos.inboundMail.get(project, inboundId);
  if (!row) return { ok: false, code: "not_found", error: `No inbound message ${inboundId} in project ${project}.` };
  if (row.dismissedAt !== null) return { ok: false, code: "wrong_state", error: `Message ${inboundId} has left Needs you already.` };
  if (m.by === "attended") {
    const known = await o.repos.mailPass.knownSender(project, inboundId);
    if (known) return { ok: false, code: "refused", error: `Not moved: ${known}. Only the owner moves a known sender's mail (Spam or Delete in the Hub).` };
  }
  let moved: Awaited<ReturnType<Mailer["moveToJunk"]>>;
  try {
    const item = { account: row.account, mailbox: row.mailbox, messageId: row.messageId };
    moved = await (m.to === "trash" ? o.mailer.moveToTrash(item) : o.mailer.moveToJunk(item));
  } catch (e) {
    moved = { moved: false, why: e instanceof Error ? e.message.slice(0, 200) : "Mail did not answer" };
  }
  if (!moved.moved) {
    log.warn(`mail not moved to ${BOX[m.to]}`, { project, inbound: inboundId, by: m.by, why: moved.why });
    return { ok: false, code: "unavailable", error: `Mail did not move it: ${moved.why}. It stays in Needs you.` };
  }
  const closed = await o.repos.mailPass.moved({ project, inboundId, to: m.to, by: m.by, at: m.at.toISOString() });
  log.info(`mail moved to ${BOX[m.to]}`, { project, inbound: inboundId, by: m.by, closed: closed.length });
  return { ok: true, closed };
}
