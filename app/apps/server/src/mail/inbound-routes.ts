import { Hono } from "hono";
import { inboundCheckedDto, inboundDetailDto, inboundTextDto, inboundDismissedDto, inboundListDto, inboundUndismissBody, leadActionDto, leadDetailDto, leadsListDto, leadsListQuery } from "@hub/contract/inbound";
import { notFound, v } from "../http/http";
import { INBOUND_OFF, projectReadOf } from "./inbound";
import { ownText } from "@hub/mail-app/own-text";
import { LEADS_OFF, projectLeadsOf } from "../clients/leads-reader";
import type { MailContext } from "./context";
import { leadDto, answerCard, rowDto } from "./inbound-view";
import { leadNotes } from "./lead-notes";
import { messageIsSitesList } from "@hub/notion";

/** How the card reads a message's text from Mail (P96 verdict 6): null with the reason when Mail cannot show it. */

/** The most rows the Inbox view lists (the bulk limit, verdict 7: Prepare all names at most this many). */
export const INBOX_LIST_MAX = 30;

/** A Notion page id in an address: 32 hex, dashes allowed. */
const pageIdOf = (raw: string): string | null => {
  const k = raw.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(k) ? k : null;
};
const DAY = 86_400_000;


const id = (raw: string): number | null => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);

/**
 * The Inbox view of Mail (P96 S1): `GET /api/projects/:slug/inbound` (one row per client who wrote and has no draft yet, the
 * reader's line), `GET .../inbound/:id` (one message, its text read from Mail now), `POST .../inbound/check` (Check now: one
 * read pass, waited for), and No reply needed with its Undo (`POST .../inbound/:id/dismiss`, `POST .../inbound/undismiss`).
 * Read-only toward Mail, so the general loopback guard is enough (rules README 7); nothing here writes Mail or starts an agent.
 */
export function inboundRoutes({ repos, projects, reader, readText, leads }: MailContext) {
  const status = () => reader?.status() ?? INBOUND_OFF;
  const project = async (slug: string) => (await repos.projects.get(slug)) !== null;
  /** P97 S2: the Leads group (verdicts 2 and 9 as answered): New leads of the last `leads.window_days`, one row per person. */
  const leadsGroup = async (slug: string) => {
    const windowDays = projects.find(slug)?.leads.windowDays ?? 14;
    const items = await repos.leadRows.open(slug, new Date(Date.now() - windowDays * DAY).toISOString());
    return { rows: items.slice(0, INBOX_LIST_MAX).map(leadDto), total: items.length, read: projectLeadsOf(leads?.status() ?? LEADS_OFF, slug, windowDays) };
  };
  return new Hono()
    // P134 verdicts 6-7: Mail ▸ Leads, one view of every lead (no cut: paged), each view's count and the view's brands.
    .get("/api/projects/:slug/leads", v("query", leadsListQuery), async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      const q = c.req.valid("query");
      const windowDays = projects.find(slug)?.leads.windowDays ?? 14;
      const r = await repos.leadRows.views(slug, q.view, new Date(Date.now() - windowDays * DAY).toISOString(), { brand: q.brand ?? null, limit: q.limit, offset: q.offset });
      const next = q.offset + r.rows.length < r.total ? q.offset + r.rows.length : null;
      return c.json(leadsListDto.parse({ rows: r.rows.map(leadDto), total: r.total, nextOffset: next, counts: r.counts, brands: r.brands, read: projectLeadsOf(leads?.status() ?? LEADS_OFF, slug, windowDays) }));
    })
    .get("/api/projects/:slug/inbound", async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      const rows = await repos.inboundMail.open(slug);
      return c.json(inboundListDto.parse({ rows: rows.slice(0, INBOX_LIST_MAX).map(rowDto), total: rows.length, read: projectReadOf(status(), slug), leads: await leadsGroup(slug) }));
    })
    .post("/api/projects/:slug/inbound/check", async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      await Promise.all([reader?.tick(), leads?.read(slug)]);
      return c.json(inboundCheckedDto.parse({ ok: true, read: projectReadOf(status(), slug) }));
    })
    .post("/api/projects/:slug/inbound/undismiss", v("json", inboundUndismissBody), async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      const { ids } = c.req.valid("json");
      await repos.inboundMail.undismiss(slug, ids);
      return c.json(inboundDismissedDto.parse({ ok: true, ids }));
    })
    .post("/api/projects/:slug/inbound/:id/dismiss", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      if (n === null || !(await repos.inboundMail.get(slug, n))) return notFound(c, "message");
      return c.json(inboundDismissedDto.parse({ ok: true, ids: await repos.inboundMail.dismiss(slug, n) }));
    })
    // P98 item 3: the card's state from SQLite only (open, the client's drafts, the draft that answers it), so a live topic
    // refreshes it without a Mail read; the Mail text is its own read below.
    .get("/api/projects/:slug/inbound/:id", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const row = n === null ? null : await repos.inboundMail.get(slug, n);
      if (!row) return notFound(c, "message");
      const clientId = await repos.clients.idByEmail(slug, row.email);
      const all = clientId === undefined ? [] : (await repos.drafts.ofClient(slug, clientId)).sort((a, b) => b.id - a.id);
      const others = (await repos.inboundMail.openOf(slug, row.email)).filter((r) => r.id !== row.id).slice(0, 10).map((r) => ({ id: r.id, subject: r.subject, receivedAt: r.receivedAt }));
      const notionUrl = (await repos.inbox.list(slug, "all")).find((r) => r.email === row.email)?.notionUrl ?? null;
      return c.json(
        inboundDetailDto.parse({
          row: { ...rowDto(row), account: row.account, mailbox: row.mailbox, messageId: row.messageId, open: row.open, dismissedAt: row.dismissedAt },
          drafts: all.slice(0, 10).map((d) => ({ id: d.id, subject: d.subject, status: d.status, createdAt: d.createdAt })),
          answer: answerCard(row, all),
          others,
          notionUrl,
        }),
      );
    })
    // The client's own words, read from Mail now (P96 verdict 6): a Mail read, so on open and on focus only (decision 0013).
    .get("/api/projects/:slug/inbound/:id/text", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const row = n === null ? null : await repos.inboundMail.get(slug, n);
      if (!row) return notFound(c, "message");
      const read = readText ? await readText(row.account, row.messageId).catch(() => ({ note: "Mail could not show this message." })) : { note: "Mail is not read here." };
      const own = "text" in read ? ownText(read.text) : null;
      return c.json(inboundTextDto.parse({ text: own ? own.text : null, quoted: own?.quoted ?? false, note: "note" in read ? read.note : null }));
    })
    // P97 S2: one lead's card, its page read from Notion now (the stored row is the minimum of decision 0013).
    .get("/api/projects/:slug/leads/:pageId", async (c) => {
      const slug = c.req.param("slug");
      const pageId = pageIdOf(c.req.param("pageId"));
      const row = pageId === null ? null : await repos.leadRows.get(slug, pageId);
      if (!row) return notFound(c, "lead");
      const read = leads ? await leads.page(slug, row.pageId).catch(() => ({ note: "Notion could not show this lead now." })) : { note: "Notion Leads are not read here." };
      const emails = [...new Set([row.email, row.accountEmail].filter((e): e is string => !!e))];
      const drafts = [];
      for (const e of emails) {
        const clientId = await repos.clients.idByEmail(slug, e);
        if (clientId !== undefined) drafts.push(...(await repos.drafts.ofClient(slug, clientId)));
      }
      const l = "lead" in read ? read.lead : null;
      return c.json(
        leadDetailDto.parse({
          row: { ...leadDto(row), open: row.open, notionStatus: row.notionStatus, dismissedAt: row.dismissedAt, dismissedReason: row.dismissedReason ?? null, convertedAt: row.convertedAt, clientPageId: row.clientPageId, convertNote: row.convertNote },
          // A Message that only lists the sites is the chips again (the carapis form writes them there): the card shows them once.
          lead: l ? { company: l.company, message: messageIsSitesList(l.message, l.sheet.sites) ? "" : l.message, form: l.form, sheet: l.sheet, read: l.read, pageUrl: l.pageUrl, phone: l.phone, brands: l.brands, otherContact: l.otherContact } : null,
          note: "note" in read ? read.note : null,
          // P138 verdict 4: the checks before a reply, from the Hub's record (the typo, a client match, the forms of this address).
          notes: await leadNotes(repos, slug, row, l?.sheet ?? null),
          drafts: drafts.sort((a, b) => b.id - a.id).slice(0, 10).map((d) => ({ id: d.id, clientId: d.clientId, subject: d.subject, status: d.status })),
        }),
      );
    })
    // Not now (verdict 2): local only, stored like No reply needed; Notion is not written.
    .post("/api/projects/:slug/leads/:pageId/not-now", async (c) => {
      const slug = c.req.param("slug");
      const pageId = pageIdOf(c.req.param("pageId"));
      if (pageId === null || !(await repos.leadRows.get(slug, pageId))) return notFound(c, "lead");
      await repos.leadRows.dismiss(slug, pageId, "not_now");
      return c.json(leadActionDto.parse({ ok: true, pageId, notion: "none", note: null }));
    })
    // Spam (verdict 8, S5): the owner's click; the row leaves the group and the lead's Status becomes Spam in Notion.
    .post("/api/projects/:slug/leads/:pageId/spam", async (c) => {
      const slug = c.req.param("slug");
      const pageId = pageIdOf(c.req.param("pageId"));
      if (pageId === null || !(await repos.leadRows.get(slug, pageId))) return notFound(c, "lead");
      await repos.leadRows.dismiss(slug, pageId, "spam");
      const r = leads ? await leads.setStatus(slug, pageId, "Spam") : { state: "off" as const, note: "Notion Leads are not written here." };
      return c.json(leadActionDto.parse({ ok: true, pageId, notion: r.state, note: r.note }));
    })
    // Undo of Not now or Spam: the row is open again; a Spam Undo sets the Status back to New.
    .post("/api/projects/:slug/leads/:pageId/undo", async (c) => {
      const slug = c.req.param("slug");
      const pageId = pageIdOf(c.req.param("pageId"));
      const row = pageId === null ? null : await repos.leadRows.get(slug, pageId);
      if (!row || pageId === null) return notFound(c, "lead");
      await repos.leadRows.undismiss(slug, pageId);
      if (row.dismissedReason !== "spam") return c.json(leadActionDto.parse({ ok: true, pageId, notion: "none", note: null }));
      const r = leads ? await leads.setStatus(slug, pageId, "New") : { state: "off" as const, note: "Notion Leads are not written here." };
      if (r.state !== "written") await repos.leadRows.setStatus(slug, [pageId], "New");
      return c.json(leadActionDto.parse({ ok: true, pageId, notion: r.state, note: r.note }));
    });
}
