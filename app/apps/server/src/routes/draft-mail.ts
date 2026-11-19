import { Hono, type Context } from "hono";
import { DraftWriteError, reviseDraft } from "@hub/agent/mail-drafts";
import { stripHubMarker } from "@hub/config";
import type { DraftRow, Repos } from "@hub/db";
import { loadProject } from "@hub/projects";
import { bareId, findMail, isThreadDraft, mailHash, type MailDraft } from "@hub/send";
import { draftEditBody, sendParam } from "@hub/contract/requests";
import { draftChangedDto, draftMailDto } from "@hub/contract/responses";
import { gateRefusal } from "../admin-gate";
import { notFound, v } from "../http";
import type { SenderOptions } from "./sends";

/**
 * The open draft's Mail text (decision 0013: read live, never stored) and the two writes a person makes to it (P56):
 * Restore (the hub's own copy from Trash, written again) and Save (the person's edited text). Both go through the agent's
 * one writer (`reviseDraft`), carry the send ticket's door (exact admin Origin, same-origin fetch: a forged write from
 * another loopback page would rewrite a client's mail), turn Checked off and bump the live topic `mail`. Nothing here sends.
 */
export function draftMailRoutes(repos: Repos, sender?: SenderOptions) {
  const mailer = sender?.mailer;
  const projectMail = (slug: string) => {
    if (!sender) return null;
    try {
      const m = loadProject(sender.projectsDir, slug, { policyDir: sender.policyDir }).parsed.config.mail;
      return { accounts: m.accounts, sender: m.sender ?? null };
    } catch {
      return null;
    }
  };
  const own = async (slug: string, id: number) => {
    const d = await repos.drafts.get(id);
    return d && d.project === slug ? d : null;
  };
  const refuse = (c: Context, error: string) => c.json({ error, code: "wrong_state" as const }, 409);
  const door = (c: Context) => (sender ? gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, sender.adminPort, { sameSite: true }) : "Mail is not set up on this server");
  /** The newest copy the hub wrote for this thread that sits in Mail's Trash, in the project's accounts. */
  const inTrash = async (d: DraftRow, accounts: readonly string[]): Promise<MailDraft | null> => {
    const ref = bareId(d.mailRef);
    if (!mailer || !ref) return null;
    const ownAcc = new Set(accounts.map((a) => a.trim().toLowerCase()));
    const list = (await mailer.findInTrash({ mailRef: d.mailRef, subject: d.subject }).catch(() => [])).filter((m) => isThreadDraft(m.body, ref) && ownAcc.has((m.account ?? "").trim().toLowerCase()));
    return [...list].sort((a, b) => (Number(b.ref) || 0) - (Number(a.ref) || 0))[0] ?? null;
  };
  /** One write through the writer, then Checked off and the live bump; a refusal of Mail is a 409 with its sentence. */
  const write = async (c: Context, d: DraftRow, body: string) => {
    const pm = projectMail(d.project);
    if (!sender?.writer || !pm) return refuse(c, "Writing Mail drafts is not set up on this server.");
    if (!d.mailRef) return refuse(c, "This draft answers no Mail message, so it cannot be written here.");
    try {
      await reviseDraft(sender.writer, { accounts: pm.accounts, sender: pm.sender, mailRef: d.mailRef, body, quote: "keep" });
    } catch (e) {
      if (e instanceof DraftWriteError) return refuse(c, `Mail did not take the draft: ${e.message}`);
      throw e;
    }
    await repos.drafts.setChecked(d.id, false, null);
    try {
      sender.mailWritten?.(d.project);
    } catch {
      // the draft is written; only the other tabs' refresh is lost (they read Mail again on focus)
    }
    return c.json(draftChangedDto.parse({ ok: true, draftId: d.id }));
  };

  return new Hono()
    // The draft as Mail holds it now. Read-only: no audit row, nothing stored. The safety checks run on this live text.
    .get("/api/projects/:slug/drafts/:id/mail", v("param", sendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      const draft = await own(slug, id);
      if (!draft) return notFound(c, "draft");
      const readAt = (sender?.now?.() ?? new Date()).toISOString();
      const empty = { from: null, to: [], cc: [], subject: "", body: "", hash: null, safetyResults: [], readAt };
      if (!mailer) return c.json(draftMailDto.parse({ configured: false, found: false, reason: "Reading Mail is not set up on this server.", note: null, ...empty }));
      // The card's read shows one version even when Mail holds several (P53); such a text has no hash, so it is never Checked.
      const f = await findMail({ mailer }, draft, "show");
      if (!f.mail) {
        const trash = f.gone ? await inTrash(draft, projectMail(slug)?.accounts ?? []) : null;
        return c.json(draftMailDto.parse({ configured: true, found: false, reason: f.reason, note: null, gone: f.gone ? { trashRef: trash?.ref ?? null } : null, ...empty }));
      }
      const m = f.mail;
      const hash = f.note ? null : mailHash(m);
      // Checked is bound to the text that was read (decision 0013): a read that shows another text turns it off at once, as
      // the send would, so the switch never shows on over a revision the owner has not read (P56).
      if (draft.checked && hash !== null && draft.checkedHash && draft.checkedHash !== hash) await repos.drafts.setChecked(id, false, null);
      const safetyResults = await repos.sends.safetyOf(id, { subject: m.subject, toAddr: m.to.join(","), ccAddr: m.cc.join(",") || null, body: m.body }, sender?.now?.());
      return c.json(draftMailDto.parse({ configured: true, found: true, reason: null, note: f.note ?? null, aside: f.aside ?? null, gone: null, checkedCurrent: draft.checked && hash !== null && (draft.checkedHash === null || draft.checkedHash === hash), from: m.sender, to: m.to, cc: m.cc, subject: m.subject, body: m.body, hash, safetyResults, readAt }));
    })
    // Restore (P56): Mail holds no draft for it, and the hub's own last copy is in Trash: write that text again.
    .post("/api/projects/:slug/drafts/:id/mail/restore", v("param", sendParam), async (c) => {
      const why = door(c);
      if (why) return c.json({ error: `Not restored: ${why}.`, code: "forbidden" as const }, 403);
      const { slug, id } = c.req.valid("param");
      const draft = await own(slug, id);
      if (!draft) return notFound(c, "draft");
      if (!mailer) return refuse(c, "Reading Mail is not set up on this server.");
      const now = await findMail({ mailer }, draft, "show");
      if (now.mail) return refuse(c, "Mail already holds a draft for this: read it again.");
      const copy = await inTrash(draft, projectMail(slug)?.accounts ?? []);
      if (!copy) return refuse(c, "No copy the Hub wrote for this draft is in Mail's Trash.");
      return write(c, draft, stripHubMarker(copy.body));
    })
    // Save (P56 S1): the person's text, written only over the very read it was edited from.
    .put("/api/projects/:slug/drafts/:id/mail", v("param", sendParam), v("json", draftEditBody), async (c) => {
      const why = door(c);
      if (why) return c.json({ error: `Not saved: ${why}.`, code: "forbidden" as const }, 403);
      const { slug, id } = c.req.valid("param");
      const { text, hash } = c.req.valid("json");
      const draft = await own(slug, id);
      if (!draft) return notFound(c, "draft");
      if (!mailer) return refuse(c, "Reading Mail is not set up on this server.");
      const f = await findMail({ mailer }, draft, "strict");
      if (!f.mail) return refuse(c, `Not saved: ${f.reason}.`);
      if (mailHash(f.mail) !== hash) return refuse(c, "Not saved: the draft changed in Mail since you started editing. Copy your text, read it again, then edit.");
      if (!text.trim()) return refuse(c, "Not saved: the text is empty.");
      return write(c, draft, text.replace(/\s+$/, ""));
    });
}
