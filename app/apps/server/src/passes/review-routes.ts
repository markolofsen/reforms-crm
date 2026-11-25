import { Hono, type Context } from "hono";
import { leadReviewDto, leadReviewParam, leadReviewQuery, leadReviewTicketBody, leadReviewTicketDto } from "@hub/contract/lead-pass";
import { LEAD_REPLY_INTENT } from "@hub/config/lead-pass";
import { assess, type SendDeps } from "@hub/send/assess";
import { BATCH_SEND_ACTOR } from "@hub/config";
import { batchTicketKey, planBatch, type BatchLimits } from "@hub/send/batch";
import { mailHash } from "@hub/send/find";
import { replyAddressOf } from "@hub/notion";
import { projectStore } from "@hub/projects/store";
import { ops } from "@hub/log/ops";
import type { Repos } from "@hub/db";
import type { LeadsHandle } from "../clients/leads-reader";
import { gateRefusal, type TicketStore } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import { AGENT_SEND_HEADER, tokenMatches } from "@hub/agent/send-token";
import { z } from "zod";
import { slugParam } from "@hub/contract/requests";
import { junkInbound } from "./mail-junk";

// The lead review (decision 0055 point 2, P147 L5, D3 D4 D10). The read shows every pass draft of the day's lead batch with its
// full text read fresh from Mail, whether or not it is Checked, beside the request, and the day's proposals and hand-overs. At
// that read the server stores the hash of the text it served (`drafts.served_hash`, D10). The owner's one click (the ticket)
// ticks Checked on exactly the drafts he left ticked, bound to that served hash (never a hash from the browser), excludes the
// unticked ones (D7), applies the ticked proposals (Spam in Notion, Not now here), and returns P85b's batch ticket for exactly
// the drafts that can go out. The run itself is P85b's apply (`/api/projects/:slug/batches/:id/send`): one door send per mail,
// the cap, the spacing, Stop. Nothing here sends.

const DAY_MS = 86_400_000;
const NOT_CHECKED = "the draft is not Checked (accepted) yet";
const log = ops("lead-pass");

export interface LeadReviewDeps {
  repos: Repos;
  deps: SendDeps | undefined;
  tickets: TicketStore;
  limits: BatchLimits;
  adminPort: number | undefined;
  projectsDir: string | undefined;
  leads?: LeadsHandle | undefined;
  /** The agent send token (decision 0046): `mail_junk` of the owner's attended session calls in with it (3m item 1). */
  agentToken?: string | undefined;
}

export function leadReviewRoutes(o: LeadReviewDeps) {
  const { repos, deps, tickets } = o;
  const door = (c: Context): Response | null => {
    const why = o.adminPort === undefined ? "no admin port" : gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, o.adminPort, { sameSite: true });
    return why ? c.json({ error: `Not sent: ${why}.`, code: "forbidden" as const }, 403) : null;
  };
  const windowFrom = (slug: string, at: Date): string => {
    let days = 14;
    try {
      if (o.projectsDir) days = projectStore({ projects: o.projectsDir }).config(slug).leads.windowDays;
    } catch {
      /* the default window */
    }
    return new Date(at.getTime() - days * DAY_MS).toISOString();
  };
  const leadBatch = async (slug: string, batchId: number) => {
    const b = await repos.batches.get(slug, batchId);
    return b && b.intent === LEAD_REPLY_INTENT ? b : null;
  };

  return new Hono()
    .get("/api/projects/:slug/lead-review/:batchId", v("param", leadReviewParam), v("query", leadReviewQuery), async (c) => {
      const { slug, batchId } = c.req.valid("param");
      const { only, stored } = c.req.valid("query");
      const picked = (id: number) => !only || only.includes(id);
      // `stored`: the Hub's own copy, at once (no Mail read, no served hash); the click needs the verified read.
      const read = async (draftId: number): Promise<{ mail: { sender: string | null; to: string[]; cc: string[]; subject: string; body: string } | null; held: string[] }> => {
        if (stored) {
          const d = await repos.drafts.get(draftId);
          const split = (s: string | null | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
          return { mail: d && d.body ? { sender: null, to: split(d.toAddr), cc: split(d.ccAddr), subject: d.subject, body: d.body } : null, held: [] };
        }
        if (!deps) return { mail: null, held: [] };
        const a = await assess(deps, draftId, { mode: "manual" });
        // D10: the hash of exactly the text served here; the ticket's Checked takes it, and an edit after this read is a new text.
        await repos.leadPass.setServedHash(slug, draftId, a.mail ? mailHash(a.mail) : null);
        return { mail: a.mail ?? null, held: a.reasons.filter((x) => x !== NOT_CHECKED) };
      };
      if (!deps) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      const batch = await leadBatch(slug, batchId);
      if (!batch) return notFound(c, "batch");
      const at = deps.now?.() ?? new Date();
      const rows = await reviewRows(repos, slug, batchId, read, picked);
      const decided = await repos.leadPass.decided(slug, windowFrom(slug, at));
      const mailDecided = await repos.mailPass.decided(slug, windowFrom(slug, at));
      const proposals = [
        ...decided.filter((r) => r.display === "proposed").map((r) => ({ kind: "lead" as const, pageId: r.pageId, inbound: null, name: r.name, email: r.email, site: r.site, request: r.preview, decision: r.passDecision === "spam" ? ("spam" as const) : ("not_now" as const), reason: r.passReason })),
        ...mailDecided.filter((r) => r.display === "proposed").map((r) => ({ kind: "mail" as const, pageId: String(r.id), inbound: r.id, name: r.name || r.email, email: r.email, site: null, request: `${r.subject} · ${r.preview}`.slice(0, 200), decision: r.passDecision === "spam" ? ("spam" as const) : ("no_reply" as const), reason: r.passReason })),
      ];
      const handOvers = [
        ...decided.filter((r) => r.display === "for_you").map((r) => ({ kind: "lead" as const, pageId: r.pageId, inbound: null, name: r.name, email: r.email, request: r.preview, reason: r.passReason })),
        ...mailDecided.filter((r) => r.passDecision === "hand_over" && r.display === "for_you").map((r) => ({ kind: "mail" as const, pageId: String(r.id), inbound: r.id, name: r.name || r.email, email: r.email, request: `${r.subject} · ${r.preview}`.slice(0, 200), reason: r.passReason })),
      ];
      // The cap from the send log alone: P85b's plan would read Mail again for every Checked draft of the batch.
      const used = (await repos.sends.actorUsage(slug, BATCH_SEND_ACTOR, at.toISOString())).sentLastDay;
      const cap = { limit: o.limits.dailyCap, used, room: Math.max(0, o.limits.dailyCap - used) };
      return c.json(leadReviewDto.parse({ batchId, name: batch.name, rows, proposals: only ? [] : proposals, handOvers: only ? [] : handOvers, cap, spacingSeconds: o.limits.spacingSeconds, verified: !stored }));
    })
    // The owner's one click: "Send N · Spam M · Not now K". The admin then starts P85b's run with the ticket and the items.
    .post("/api/projects/:slug/lead-review/:batchId/ticket", v("param", leadReviewParam), v("json", leadReviewTicketBody), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug, batchId } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!deps) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      if (!(await leadBatch(slug, batchId))) return notFound(c, "batch");
      const at = (deps.now?.() ?? new Date()).toISOString();
      // Both passes' drafts of this batch (P147 3h): a lead row by its page, a mail row by its inbound id.
      const mine = new Map<number, { name: string; pageId: string | null; inbound: number | null }>([
        ...(await repos.leadPass.ofBatch(slug, batchId)).filter((r) => r.passDraftId !== null).map((r) => [r.passDraftId as number, { name: r.name, pageId: r.pageId, inbound: null }] as const),
        ...(await repos.mailPass.ofBatch(slug, batchId)).filter((r) => r.passDraftId !== null).map((r) => [r.passDraftId as number, { name: r.name || r.email, pageId: null, inbound: r.id }] as const),
        // P145 B4: a fixed bug's note; unticked, it is only unchecked (it has no pass row to mark Excluded).
        ...(await repos.bugNotes.ofBatch(slug, batchId)).filter((n) => n.draftId !== null).map((n) => [n.draftId as number, { name: "a fixed bug’s note", pageId: null, inbound: null }] as const),
      ]);
      const held: { draftId: number; name: string; reasons: string[] }[] = [];
      // The ticked drafts: Checked, bound to the text the review served (D10). A draft never served, or edited since, is held.
      const ticked: number[] = [];
      for (const id of body.send) {
        const r = mine.get(id);
        if (!r) {
          held.push({ draftId: id, name: `draft ${id}`, reasons: ["the draft is not a pass draft of this lead batch"] });
          continue;
        }
        const d = await repos.drafts.get(id);
        const a = await assess(deps, id, { mode: "manual" });
        const now = a.mail ? mailHash(a.mail) : null;
        if (!d?.servedHash || now === null || now !== d.servedHash) {
          held.push({ draftId: id, name: r.name, reasons: [now === null ? (a.reasons[0] ?? "Mail does not hold this draft now") : "the draft changed in Mail after the review showed it: open the review again"] });
          continue;
        }
        if (!d.checked || d.checkedHash !== d.servedHash) await repos.drafts.setChecked(id, true, d.servedHash);
        ticked.push(id);
      }
      // The unticked ones (D7): excluded from this batch, unchecked, Excluded on the card; the next pass leaves them alone.
      const excludePages: string[] = [];
      const excludeInbound: number[] = [];
      for (const id of body.exclude) {
        const r = mine.get(id);
        if (!r || body.send.includes(id)) continue;
        const d = await repos.drafts.get(id);
        if (d?.checked) await repos.drafts.setChecked(id, false);
        if (r.pageId !== null) excludePages.push(r.pageId);
        if (r.inbound !== null) excludeInbound.push(r.inbound);
      }
      const excluded = (excludePages.length ? await repos.leadPass.exclude(slug, excludePages, at) : 0) + (await repos.mailPass.exclude(slug, excludeInbound, at));
      // The ticked proposals: Spam (here and in Notion) and Not now (here), each only on a proposal of that kind. A mail pass
      // proposal (P147 3h): No reply is the owner's No reply needed on that thread; Spam (junk or phishing, 3m item 1) moves the
      // message to Mail's Junk first (recoverable), and one Mail did not move stays in Needs you with a note.
      const applied = { spam: 0, notNow: 0, noReply: 0, junk: 0, excluded, notion: [] as string[], notMoved: [] as string[] };
      for (const p of body.proposals) {
        if (p.inbound !== undefined) {
          const m = await repos.mailPass.item(slug, p.inbound);
          if (!m || m.display !== "proposed" || m.passDecision !== p.decision) continue;
          if (p.decision === "spam") {
            const j = await junkInbound({ repos, mailer: deps.mailer }, slug, m.id, "review", deps.now?.() ?? new Date());
            if (j.ok) applied.junk++;
            else applied.notMoved.push(`${m.name || m.email}: ${j.error}`);
          } else {
            await repos.inboundMail.dismiss(slug, m.id);
            applied.noReply++;
          }
          continue;
        }
        if (p.pageId === undefined || p.decision === "no_reply") continue;
        const id = p.pageId.replace(/-/g, "").toLowerCase();
        const r = await repos.leadPass.item(slug, id);
        if (!r || r.display !== "proposed" || r.passDecision !== p.decision) continue;
        if (p.decision === "spam") {
          await repos.leadRows.dismiss(slug, id, "spam");
          const n = o.leads ? await o.leads.setStatus(slug, id, "Spam") : { state: "off" as const, note: "Notion Leads are not written here." };
          if (n.note) applied.notion.push(`${r.name}: ${n.note}`);
          applied.spam++;
        } else {
          await repos.leadRows.dismiss(slug, id, "not_now");
          applied.notNow++;
        }
      }
      // What can go out now: P85b's plan of the Checked drafts, cut to exactly the ticked ones; the rest of the plan's held say why.
      const plan = await planBatch(deps, slug, batchId, o.limits, ticked);
      const items = (plan?.items ?? []).filter((i) => ticked.includes(i.draftId));
      for (const h of plan?.held ?? []) if (ticked.includes(h.draftId)) held.push({ draftId: h.draftId, name: h.name, reasons: h.reasons });
      const ticket = items.length ? tickets.mint(batchTicketKey(batchId, items)).ticket : null;
      log.info("lead review confirmed", { project: slug, batch: batchId, send: items.length, held: held.length, spam: applied.spam, notNow: applied.notNow, excluded });
      return c.json(leadReviewTicketDto.parse({ ticket, items: items.map((i) => ({ draftId: i.draftId, name: i.name, to: i.to, subject: i.subject, hash: i.hash })), held, applied }));
    })
    // 3m item 1: `mail_junk` of the owner's attended session, a loopback call with the agent send token (decision 0046), never the
    // admin's Origin. One inbound message to Mail's Junk, then out of Needs you with an Activity line. Nothing is sent.
    .post("/api/projects/:slug/mail/inbound/:id/agent-junk", v("param", slugParam.extend({ id: z.coerce.number().int().positive() })), async (c) => {
      if (!o.agentToken || !tokenMatches(c.req.header(AGENT_SEND_HEADER), o.agentToken)) return c.json({ error: "Refused: only the hub's own MCP server may ask this.", code: "forbidden" as const }, 403);
      if (!deps) return c.json({ error: "Mail is not set up on this server.", code: "wrong_state" as const }, 409);
      const { slug, id } = c.req.valid("param");
      const j = await junkInbound({ repos, mailer: deps.mailer }, slug, id, "attended", deps.now?.() ?? new Date());
      if (!j.ok) return c.json({ error: j.error, code: j.code }, j.code === "not_found" ? 404 : 409);
      return c.json({ ok: true as const, closed: j.closed.length });
    });
}

type ReviewRead = (draftId: number) => Promise<{ mail: { sender: string | null; to: string[]; cc: string[]; subject: string; body: string } | null; held: string[] }>;

/** The review's rows: the lead pass's replies, the mail pass's (P147 3h), then the fixed bugs' notes (P145 B4). */
async function reviewRows(repos: Repos, slug: string, batchId: number, read: ReviewRead, picked: (id: number) => boolean) {
  const rows = [];
  for (const r of await repos.leadPass.ofBatch(slug, batchId)) {
    if (r.passDraftId === null || !picked(r.passDraftId)) continue;
    const a = await read(r.passDraftId);
    const held = a.held;
    const excluded = r.display === "excluded";
    const to = replyAddressOf(r);
    const language = languageLine((await repos.drafts.get(r.passDraftId))?.context ?? null);
    rows.push({
      pageId: r.pageId,
      name: r.name,
      email: r.email,
      replyWhy: to.why,
      language,
      brand: r.brand,
      receivedAt: r.receivedAt,
      request: r.preview,
      decision: r.passDecision ?? "reply",
      reason: r.passReason,
      display: r.display,
      draftId: r.passDraftId,
      mail: a.mail ? { from: a.mail.sender ?? "", to: a.mail.to, cc: a.mail.cc, subject: a.mail.subject, body: a.mail.body } : null,
      held,
      // 3i P2: a needs-input draft is shown For you; once its marker is filled (nothing held) it ticks like any other.
      ticked: held.length === 0 && !excluded && a.mail !== null && (r.display === "drafted" || r.display === "for_you"),
    });
  }
  // P147 3h: the mail pass's replies, grouped after the leads; a first reply to a new sender opens unticked.
  for (const m of await repos.mailPass.ofBatch(slug, batchId)) {
    if (m.passDraftId === null || !picked(m.passDraftId)) continue;
    const a = await read(m.passDraftId);
    const held = a.held;
    const display = m.display === "dismissed" ? ("excluded" as const) : m.display === "new" ? ("drafted" as const) : m.display;
    rows.push({
      kind: "mail" as const,
      newSender: m.newSender,
      pageId: String(m.id),
      name: m.name || m.email,
      email: m.email,
      replyWhy: "the sender's address",
      language: languageLine((await repos.drafts.get(m.passDraftId))?.context ?? null),
      brand: null,
      receivedAt: m.receivedAt,
      request: m.preview,
      decision: m.passDecision ?? "reply",
      reason: m.passReason,
      display,
      draftId: m.passDraftId,
      mail: a.mail ? { from: a.mail.sender ?? "", to: a.mail.to, cc: a.mail.cc, subject: a.mail.subject, body: a.mail.body } : null,
      held,
      ticked: !m.newSender && held.length === 0 && a.mail !== null && (display === "drafted" || display === "for_you"),
    });
  }
  // P145 B4: the fixed bugs' notes the follow-up sweep added to this list; they tick like any ready reply.
  for (const n of await repos.bugNotes.ofBatch(slug, batchId)) {
    if (n.draftId === null || !picked(n.draftId)) continue;
    const a = await read(n.draftId);
    const d = await repos.drafts.get(n.draftId);
    const client = await repos.clients.get(slug, n.clientId);
    rows.push({
      kind: "fixed" as const,
      pageId: n.reportPageId,
      name: client?.name || client?.email || `client ${n.clientId}`,
      email: client?.email ?? null,
      replyWhy: "the client's address",
      language: languageLine(d?.context ?? null),
      brand: null,
      receivedAt: n.draftedAt ?? n.createdAt,
      request: "A bug they reported is fixed: a short note asking them to check",
      decision: "reply" as const,
      reason: null,
      display: "drafted" as const,
      draftId: n.draftId,
      mail: a.mail ? { from: a.mail.sender ?? "", to: a.mail.to, cc: a.mail.cc, subject: a.mail.subject, body: a.mail.body } : null,
      held: a.held,
      ticked: a.held.length === 0 && a.mail !== null && n.toldAt === null,
    });
  }
  return rows;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });
const nameOf = (code: string) => {
  try {
    return LANGUAGE_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

/** P147 3f G3: "Reply in Spanish (client wrote in Spanish)" from a draft's record context, or null. Pure. */
export function languageLine(context: string | null): string | null {
  if (!context) return null;
  try {
    const l = (JSON.parse(context) as { language?: { client?: string; reply?: string } }).language;
    return l?.client && l.reply ? `Reply in ${nameOf(l.reply)} (client wrote in ${nameOf(l.client)})` : null;
  } catch {
    return null;
  }
}
