import { Hono, type Context } from "hono";
import { leadReviewDto, leadReviewParam, leadReviewTicketBody, leadReviewTicketDto } from "@hub/contract/lead-pass";
import { LEAD_REPLY_INTENT } from "@hub/config/lead-pass";
import { assess, type SendDeps } from "@hub/send/assess";
import { batchTicketKey, planBatch, type BatchLimits } from "@hub/send/batch";
import { mailHash } from "@hub/send/find";
import { replyAddressOf } from "@hub/notion";
import { projectStore } from "@hub/projects/store";
import { ops } from "@hub/log/ops";
import type { Repos } from "@hub/db";
import type { LeadsHandle } from "../clients/leads-reader";
import { gateRefusal, type TicketStore } from "../http/admin-gate";
import { notFound, v } from "../http/http";

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
    .get("/api/projects/:slug/lead-review/:batchId", v("param", leadReviewParam), async (c) => {
      const { slug, batchId } = c.req.valid("param");
      if (!deps) return c.json({ error: "Sending is not set up on this server.", code: "wrong_state" as const }, 409);
      const batch = await leadBatch(slug, batchId);
      if (!batch) return notFound(c, "batch");
      const at = deps.now?.() ?? new Date();
      const rows = [];
      for (const r of await repos.leadPass.ofBatch(slug, batchId)) {
        if (r.passDraftId === null) continue;
        const a = await assess(deps, r.passDraftId, { mode: "manual" });
        const held = a.reasons.filter((x) => x !== NOT_CHECKED);
        // D10: the hash of exactly the text served here; the ticket's Checked takes it, and an edit after this read is a new text.
        await repos.leadPass.setServedHash(slug, r.passDraftId, a.mail ? mailHash(a.mail) : null);
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
          mail: a.mail ? { from: a.mail.sender, to: a.mail.to, cc: a.mail.cc, subject: a.mail.subject, body: a.mail.body } : null,
          held,
          // 3i P2: a needs-input draft is shown For you; once its marker is filled (nothing held) it ticks like any other.
          ticked: held.length === 0 && !excluded && a.mail !== null && (r.display === "drafted" || r.display === "for_you"),
        });
      }
      const decided = await repos.leadPass.decided(slug, windowFrom(slug, at));
      const proposals = decided.filter((r) => r.display === "proposed").map((r) => ({ pageId: r.pageId, name: r.name, email: r.email, site: r.site, request: r.preview, decision: r.passDecision === "spam" ? ("spam" as const) : ("not_now" as const), reason: r.passReason }));
      const handOvers = decided.filter((r) => r.display === "for_you").map((r) => ({ pageId: r.pageId, name: r.name, email: r.email, request: r.preview, reason: r.passReason }));
      const plan = await planBatch(deps, slug, batchId, o.limits);
      return c.json(leadReviewDto.parse({ batchId, name: batch.name, rows, proposals, handOvers, cap: plan?.cap ?? { limit: o.limits.dailyCap, used: 0, room: o.limits.dailyCap }, spacingSeconds: o.limits.spacingSeconds }));
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
      const mine = new Map((await repos.leadPass.ofBatch(slug, batchId)).filter((r) => r.passDraftId !== null).map((r) => [r.passDraftId as number, r]));
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
      for (const id of body.exclude) {
        const r = mine.get(id);
        if (!r || body.send.includes(id)) continue;
        const d = await repos.drafts.get(id);
        if (d?.checked) await repos.drafts.setChecked(id, false);
        excludePages.push(r.pageId);
      }
      const excluded = excludePages.length ? await repos.leadPass.exclude(slug, excludePages, at) : 0;
      // The ticked proposals: Spam (here and in Notion) and Not now (here), each only on a proposal of that kind.
      const applied = { spam: 0, notNow: 0, excluded, notion: [] as string[] };
      for (const p of body.proposals) {
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
      const plan = await planBatch(deps, slug, batchId, o.limits);
      const items = (plan?.items ?? []).filter((i) => ticked.includes(i.draftId));
      for (const h of plan?.held ?? []) if (ticked.includes(h.draftId)) held.push({ draftId: h.draftId, name: h.name, reasons: h.reasons });
      const ticket = items.length ? tickets.mint(batchTicketKey(batchId, items)).ticket : null;
      log.info("lead review confirmed", { project: slug, batch: batchId, send: items.length, held: held.length, spam: applied.spam, notNow: applied.notNow, excluded });
      return c.json(leadReviewTicketDto.parse({ ticket, items: items.map((i) => ({ draftId: i.draftId, name: i.name, to: i.to, subject: i.subject, hash: i.hash })), held, applied }));
    });
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
