import { Hono } from "hono";
import { personBrand, signAsPerson } from "@hub/agent/drafts/person";
import { writeFirstMailDraft } from "@hub/agent/drafts/write";
import { writeLogOf, type Revision } from "@hub/agent/mail";
import { newThreadKey } from "@hub/config";
import { recordVersion } from "./versions";
import { DraftWriteError } from "@hub/mail-app/writer/types";
import { displayNameFor, headersFromText, resolveBrand, type BrandResolution } from "@hub/projects/brands";
import { manualReplyBody, sendParam } from "@hub/contract/requests";
import { draftChangedDto } from "@hub/contract/review";
import { notFound, v } from "../http/http";
import type { MailContext } from "./context";
import { draftMailKit } from "./draft-mail-kit";

/**
 * The owner's manual first reply (P99 amendment): one owner-authored unsent draft for a conversation without one, written
 * through the same first write as the agent's (`writeFirstMailDraft`, P126 M3), then recorded. It is not Send: the draft
 * still goes through the normal review and the send door. It carries the send ticket's door. Nothing here sends.
 */
export function manualDraftRoutes(services: MailContext) {
  const { repos, sender } = services;
  const { projectMail, refuse, door } = draftMailKit(services);
  return new Hono().post("/api/projects/:slug/clients/:id/draft", v("param", sendParam), v("json", manualReplyBody), async (c) => {
    const why = door(c);
    if (why) return c.json({ error: `Not saved: ${why}.`, code: "forbidden" as const }, 403);
    const { slug, id } = c.req.valid("param");
    const input = c.req.valid("json");
    const row = await repos.conversations.one(slug, id);
    if (!row) return notFound(c, "client");
    if (row.draft) return refuse(c, "This conversation already has an unsent draft. Edit that draft instead.");
    const pm = projectMail(slug);
    if (!sender?.writer || !pm) return refuse(c, "Writing Mail drafts is not set up on this server.");
    const writer = sender.writer;
    const facts = await repos.conversations.facts(slug, row.client.id);
    const recorded = [...new Set([...(facts?.drafts ?? [])].sort((a, b) => b.id - a.id).map((d) => d.brand).filter((b): b is string => Boolean(b)))];
    const latest = facts
      ? [
          ...facts.inbound.map((m) => ({ messageId: m.messageId, at: m.receivedAt, subject: m.subject })),
          ...facts.sends.filter((s) => s.status === "sent" && s.sentMessageId).map((s) => ({ messageId: s.sentMessageId as string, at: s.doneAt ?? s.createdAt, subject: s.subject })),
        ].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
      : null;
    const incoming = row.inboundId === null ? null : await repos.inboundMail.get(slug, row.inboundId);
    if (row.inboundId !== null && (!incoming || !incoming.open)) return refuse(c, "The incoming message is no longer open. Refresh the conversation and try again.");
    const threadRef = incoming?.messageId ?? (row.inboundId === null ? latest?.messageId ?? null : null);
    const target = threadRef ? await writer.findInbound(pm.accounts, threadRef) : null;
    if (row.inboundId !== null && !target) return refuse(c, "Mail could not find the incoming message. Refresh the conversation and try again.");
    const existing = target ? await writer.threadDrafts(pm.accounts, threadRef ?? "", incoming?.subject ?? latest?.subject ?? row.subject) : [];
    if (existing.length > 0) return refuse(c, "Mail already has an unsent draft for this conversation. Read or resolve it in Mail first.");

    // A manual reply can still be written from the receiving account when an old Mail message has no readable headers.
    let fromHeaders: BrandResolution | null = null;
    if (target) fromHeaders = await writer.readHeaders(target).then((h) => resolveBrand(headersFromText(h), { mail: pm, brands: pm.brands })).catch(() => null);
    const chosen = personBrand(pm.brands, { fromHeaders, recorded, requested: input.brand ?? null });
    if (!chosen.ok) return refuse(c, chosen.why);
    const { brand, wroteTo } = chosen;

    const body = input.text.trimEnd();
    const subject = incoming?.subject || latest?.subject || row.subject || "New message";
    const mailRef = target ? threadRef : null;
    const writeKey = mailRef ?? newThreadKey(row.client.email);
    const signing = brand || wroteTo ? { brand, wroteTo, reason: chosen.resolution?.reason ?? "the conversation's recorded Mail context" } : null;
    const { body: signedBody, ...how } = signAsPerson(pm, signing, "the conversation has no recorded brand context")(body);
    if (how.signature === "placeholder") return refuse(c, "The selected brand has no configured signature. Choose a brand with a signature before saving this Mail draft.");
    let revision: Revision;
    try {
      revision = await writeFirstMailDraft({
        writer,
        mail: pm,
        displayName: displayNameFor(pm, brand),
        target: target ? { kind: "reply", inbound: target } : { kind: "new", to: row.client.email, subject, account: pm.accounts[0] ?? "", from: pm.sender },
        body: signedBody,
        signed: how,
        quote: "keep",
        log: writeLogOf((fn) => fn(repos), slug, null, writeKey),
      });
    } catch (e) {
      if (e instanceof DraftWriteError && e.code === "mail_slow") return refuse(c, "Mail is slow: the draft may still land. Do not save again now; refresh this conversation shortly.");
      if (e instanceof DraftWriteError) return refuse(c, `Mail did not take the draft: ${e.message}`);
      throw e;
    }

    await recordVersion(repos, { project: slug, mailRef: writeKey, account: revision.account, mailId: revision.draftId, messageId: revision.messageId, text: revision.text, source: "save", signatureFallback: revision.signatureFallback ?? null });
    const rec = await repos.drafts.record({
      project: slug,
      email: row.client.email,
      name: row.client.name,
      subject,
      mailRef,
      newThread: mailRef === null,
      manual: true,
      reason: null,
      excerpt: body.replace(/\s+/g, " ").trim().slice(0, 240),
      lastContactAt: incoming?.receivedAt ?? row.theirLastAt,
      repliesOwed: false,
      skill: "manual-reply",
      wroteTo: revision.clientWroteTo ?? wroteTo,
      brand: revision.brand ?? brand,
    });
    if (!rec.recorded) return refuse(c, "The draft was written to Mail, but the Hub could not record it. Refresh the conversation before trying again.");
    try {
      sender.mailWritten?.(slug);
    } catch {
      // The draft is written; the open page will read the updated row on its next refresh.
    }
    return c.json(draftChangedDto.parse({ ok: true, draftId: rec.draftId }));
  });
}
