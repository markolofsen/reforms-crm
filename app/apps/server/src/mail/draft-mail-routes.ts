import { Hono, type Context } from "hono";
import { DraftRefused, reviseMailDraft } from "@hub/agent/drafts/write";
import { signAsPerson } from "@hub/agent/drafts/person";
import { writeLogOf } from "@hub/agent/mail";
import { versionHashOf, type DraftRow, type MailVersionRow } from "@hub/db";
import { DraftWriteError } from "@hub/mail-app/writer/types";
import type { MailDraft } from "@hub/mail-app/drafts";
import { bareId } from "@hub/mail-app/records";
import { findMail, mailHash, runSweep, settleThread } from "@hub/send";
import { draftEditBody, sendParam } from "@hub/contract/requests";
import { draftChangedDto, draftMailDto, mailTidyDto } from "@hub/contract/responses";
import { notFound, v } from "../http/http";
import type { MailServices } from "../composition/capabilities";
import { draftMailKit } from "./draft-mail-kit";

/**
 * The open draft's Mail text (decision 0013: read live, never stored) and the two writes a person makes to it (P56):
 * Restore (the hub's own copy from Trash, written again) and Save (the person's edited text). Both go through the one
 * revision use case the agent's `draft_write` uses too (`reviseMailDraft`, P126 M3), carry the send ticket's door (exact admin Origin, same-origin fetch: a forged write from
 * another loopback page would rewrite a client's mail), turn Checked off and bump the live topic `mail`. Each records the
 * Mail version it saved (`mail_versions`, P65), and the replace moves only the versions the Hub recorded. The read heals a
 * thread the Hub crowded itself (P65 S5, `settleThread`): its own late saves are adopted, its older versions go to Trash.
 * Nothing here sends.
 */
export function draftMailRoutes({ repos, sender }: MailServices) {
  const mailer = sender?.mailer;
  const { projectMail, own, refuse, door } = draftMailKit({ repos, sender });
  /** The thread rule's scope (P65): the project's accounts and the versions the Hub recorded for this draft. */
  const scopeOf = async (d: DraftRow) => ({ accounts: projectMail(d.project)?.accounts ?? null, versions: await repos.mailVersions.ofDraft(d.id) });
  /**
   * Restore (P65 verdict 3b): the newest version the Hub recorded for this draft whose Message-ID is in its account's
   * Trash (Mail's id changes on the move, its Message-ID does not). Never a copy the Hub did not record.
   */
  const inTrash = async (d: DraftRow, accounts: readonly string[]): Promise<MailDraft | null> => {
    if (!mailer || !bareId(d.mailRef)) return null;
    const ownAcc = new Set(accounts.map((a) => a.trim().toLowerCase()));
    const trash = (await mailer.findInTrash({ mailRef: d.mailRef, subject: d.subject }).catch(() => [])).filter((m) => ownAcc.has((m.account ?? "").trim().toLowerCase()));
    for (const v of await repos.mailVersions.ofDraft(d.id)) {
      const hit = trash.find((m) => bareId(m.messageId) === bareId(v.messageId) && (m.account ?? "").trim().toLowerCase() === v.account.trim().toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
  /** One write through the writer, then the version recorded, Checked off and the live bump; a refusal of Mail is a 409 with its sentence. */
  const write = async (c: Context, d: DraftRow, body: string, source: "save" | "restore") => {
    const pm = projectMail(d.project);
    if (!sender?.writer || !pm) return refuse(c, "Writing Mail drafts is not set up on this server.");
    const live: MailVersionRow[] = (await repos.mailVersions.ofDraft(d.id)).filter((v) => !v.trashedAt);
    // A person's text is signed from the draft's recorded Mail context (its brand and the address the client wrote to).
    const resolution = d.brand || d.wroteTo ? { brand: d.brand ?? null, wroteTo: d.wroteTo ?? null, via: "none" as const, reason: "the draft's recorded Mail context" } : null;
    const signText = signAsPerson(pm, resolution, "the draft has no recorded brand context");
    try {
      const { r, mailRef } = await reviseMailDraft({ actor: "person", draft: d, body, writer: sender.writer, mail: pm, brands: pm, live, quote: "keep", signNew: signText, signReply: async (_inbound, text) => signText(text), log: (ref) => writeLogOf((fn) => fn(repos), d.project, d.id, ref) });
      await repos.mailVersions.add({ project: d.project, mailRef, draftId: d.id, account: r.account, mailId: r.draftId, messageId: r.messageId, hash: versionHashOf(r.text), source });
      const moved = new Set(r.replaced.map(bareId));
      await repos.mailVersions.markTrashed(live.filter((v) => moved.has(bareId(v.messageId))).map((v) => v.id));
    } catch (e) {
      if (e instanceof DraftRefused) return refuse(c, e.message);
      // P65 S5: slow is not failed. The write is recorded; the card's next read adopts it when Mail saves it.
      if (e instanceof DraftWriteError && e.code === "mail_slow") return refuse(c, "Mail is slow: it has not shown the saved draft yet. It may still land; the card shows the new text when Mail saves it, and the Hub then moves the older version to Trash. Do not save again now.");
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
      let f = await findMail({ mailer }, draft, "show", await scopeOf(draft));
      // P65 S5: several drafts in the thread may all be the Hub's (a late save, a second save): adopt them and keep the
      // newest, then read again. A draft the Hub did not write stays and keeps the note.
      if (f.note && sender) {
        const accounts = projectMail(slug)?.accounts ?? [];
        const writer = sender.writer;
        // Mail's empty reply in the thread (no text of anyone's) is recognised against the answered message (P65 S5).
        const original = writer && draft.mailRef ? async () => { const m = await writer.findInbound(accounts, draft.mailRef ?? ""); return m ? writer.readContent(m) : null; } : undefined;
        const healed = await settleThread({ mailer, repos, ...(original ? { original } : {}) }, draft, accounts).catch(() => null);
        // The version rows it wrote bump the live topic `mail` themselves (their triggers), so other tabs read again.
        if (healed && (healed.adopted.length || healed.moved.length)) f = await findMail({ mailer }, draft, "show", await scopeOf(draft));
      }
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
      return c.json(draftMailDto.parse({ configured: true, found: true, reason: null, note: f.note ?? null, aside: f.aside ?? null, gone: null, checkedCurrent: draft.checked && hash !== null && (draft.checkedHash === null || draft.checkedHash === hash), from: m.sender, messageId: m.messageId, to: m.to, cc: m.cc, subject: m.subject, body: m.body, hash, safetyResults, readAt }));
    })
    // Restore (P56): Mail holds no draft for it, and the hub's own last copy is in Trash: write that text again.
    .post("/api/projects/:slug/drafts/:id/mail/restore", v("param", sendParam), async (c) => {
      const why = door(c);
      if (why) return c.json({ error: `Not restored: ${why}.`, code: "forbidden" as const }, 403);
      const { slug, id } = c.req.valid("param");
      const draft = await own(slug, id);
      if (!draft) return notFound(c, "draft");
      if (!mailer) return refuse(c, "Reading Mail is not set up on this server.");
      const now = await findMail({ mailer }, draft, "show", await scopeOf(draft));
      if (now.mail) return refuse(c, "Mail already holds a draft for this: read it again.");
      const copy = await inTrash(draft, projectMail(slug)?.accounts ?? []);
      if (!copy) return refuse(c, "No version the Hub recorded for this draft is in Mail's Trash.");
      return write(c, draft, copy.body, "restore");
    })
    // Tidy (P105): the review dialog's fix for "Mail holds more than one draft for this". The Hub's own leftovers in Mail's Drafts
    // go to Trash (recoverable from Mail's Trash), exactly what `hub drafts sweep --apply` moves for the project: versions the Hub
    // recorded (`mail_versions`) that a newer one superseded or whose draft is closed. A draft the owner wrote is never listed.
    // Nothing is deleted for good and nothing is sent; it carries the same door as Restore and Save.
    .post("/api/projects/:slug/drafts/:id/mail/tidy", v("param", sendParam), async (c) => {
      const why = door(c);
      if (why) return c.json({ error: `Not moved: ${why}.`, code: "forbidden" as const }, 403);
      const { slug, id } = c.req.valid("param");
      const draft = await own(slug, id);
      if (!draft) return notFound(c, "draft");
      if (!mailer) return refuse(c, "Reading Mail is not set up on this server.");
      const r = await runSweep({ mailer, repos }, { project: slug, accounts: projectMail(slug)?.accounts ?? [], apply: true });
      return c.json(mailTidyDto.parse({ ok: true, moved: r.moved.length, refused: r.refused.length }));
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
      const f = await findMail({ mailer }, draft, "strict", await scopeOf(draft));
      if (!f.mail) return refuse(c, `Not saved: ${f.reason}.`);
      if (mailHash(f.mail) !== hash) return refuse(c, "Not saved: the draft changed in Mail since you started editing. Copy your text, read it again, then edit.");
      if (!text.trim()) return refuse(c, "Not saved: the text is empty.");
      return write(c, draft, text.replace(/\s+$/, ""), "save");
    });
}
