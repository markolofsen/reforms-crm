import { newThreadKey } from "@hub/config";
import { displayNameFor, visibleFrom } from "@hub/projects/brand";
import { alreadySentText, draftFinishedText, isNewThreadDraft, reviseDraft, writeLogOf } from "../mail";
import { ToolError } from "../mcp/result";
import { adoptLate } from "./adopt";
import type { DraftScope, Written } from "./sign";

/** `draft_write {draft}`: a revision of a hub draft, through the one revision path shared with the admin's Save and Restore (P56). */
export async function reviseHubDraft(s: DraftScope, draft: number, content: string): Promise<Written> {
  const { ctx, slug, writer, mail, cfg } = s;
  const { d } = await ctx.ownDraft(draft);
  // P83 verdict 2: a sent mail is not revised, and no second draft is made for the message it answered.
  if (d.status === "sent") throw new ToolError("already_sent", alreadySentText(d.id, d.sentAt ?? null));
  // P99 S0 (a): a finished draft is refused before Mail is asked (draft 4 on 2026-11-21: the write landed, then the record refused).
  if (d.status === "done" || d.status === "skipped") throw new ToolError("draft_finished", draftFinishedText(d.id, d.status));
  const log = (mailRef: string) => (ctx.env.withRepos ? { log: writeLogOf(ctx.env.withRepos, slug, d.id, mailRef) } : {});
  if (!d.mailRef && isNewThreadDraft(d)) {
    // P85b: a new thread is revised as a new message to the same client, the recorded versions replaced.
    const client = d.toAddr.match(/[^\s,;<>"']+@[^\s,;<>"']+/)?.[0] ?? d.toAddr;
    const mailRef = newThreadKey(client);
    const live = (await ctx.repos.mailVersions.ofDraft(d.id)).filter((v) => !v.trashedAt);
    const acc = live[0]?.account ?? mail.accounts[0];
    if (!acc) throw new ToolError("not_this_project", `Project ${slug} lists no Mail account.`);
    // P97 S3: a new thread signed as a named brand keeps that brand on revision.
    const signed = s.signFrom(mail.sender ?? acc, content, d.brand ?? null);
    const { body: _b, ...how } = signed;
    const r = { ...(await reviseDraft(writer, { accounts: mail.accounts, sender: mail.sender, displayName: displayNameFor(cfg, signed.brand), mailRef: null, body: signed.body, quote: "keep", versions: live.map((v) => ({ account: v.account, messageId: v.messageId })), newThread: { to: client, subject: d.subject, account: acc, from: visibleFrom(mail.sender, displayNameFor(cfg, signed.brand)) }, ...log(mailRef) })), ...how };
    return { r, mailRef, versionRows: live.map((v) => ({ id: v.id, messageId: v.messageId })) };
  }
  if (!d.mailRef) throw new ToolError("no_thread", `Draft ${draft} has no mailRef: it answers no Mail message, so it cannot be revised here.`);
  const all = await ctx.repos.mailVersions.ofDraft(d.id);
  // P65 S5: a late save of the Hub's own earlier write is adopted first, so this write replaces it too.
  const adopted = await adoptLate(ctx, slug, d.id, d.mailRef, d.subject, all);
  const live = [...all.filter((v) => !v.trashedAt), ...adopted];
  // The one revision path, shared with the admin's Save and Restore (P56).
  const r = await reviseDraft(writer, { accounts: mail.accounts, sender: mail.sender, clientWroteTo: d.wroteTo ?? null, displayName: displayNameFor(cfg, d.brand), mailRef: d.mailRef, body: content, quote: "add", versions: live.map((v) => ({ account: v.account, messageId: v.messageId })), ...(s.sign ? { sign: s.sign } : {}), ...log(d.mailRef) });
  return { r, mailRef: d.mailRef, versionRows: live.map((v) => ({ id: v.id, messageId: v.messageId })) };
}
