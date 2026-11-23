import { writeLogOf } from "../mail";
import { adoptLate } from "./adopt";
import type { DraftScope, Written } from "./sign";
import { reviseMailDraft } from "./write";

/** `draft_write {draft}`: a revision of a hub draft, through the one use case shared with the admin's Save and Restore (P56, P126 M3). */
export async function reviseHubDraft(s: DraftScope, draft: number, content: string): Promise<Written> {
  const { ctx, slug, writer, mail, cfg } = s;
  const { d } = await ctx.ownDraft(draft);
  const all = await ctx.repos.mailVersions.ofDraft(d.id);
  // A reply first adopts its own late saves (P65 S5), so the replace sees them; a new thread has none to adopt.
  const adopted = d.mailRef && d.status !== "sent" && d.status !== "done" && d.status !== "skipped" ? await adoptLate(ctx, slug, d.id, d.mailRef, d.subject, all) : [];
  const live = [...all.filter((v) => !v.trashedAt), ...adopted];
  const { r, mailRef } = await reviseMailDraft({
    actor: "agent",
    draft: d,
    body: content,
    writer,
    mail,
    brands: cfg,
    live,
    quote: "add",
    signNew: (body) => s.signFrom(mail.sender ?? live[0]?.account ?? mail.accounts[0] ?? "", body, d.brand ?? null),
    ...(s.sign ? { signReply: s.sign } : {}),
    ...(ctx.env.withRepos ? { log: (ref: string) => writeLogOf(ctx.env.withRepos!, slug, d.id, ref) } : {}),
  });
  return { r, mailRef, versionRows: live.map((v) => ({ id: v.id, messageId: v.messageId })) };
}
