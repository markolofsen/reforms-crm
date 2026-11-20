import { Hono } from "hono";
import type { InboundRow, Repos } from "@hub/db";
import { inboundCheckedDto, inboundDetailDto, inboundDismissedDto, inboundListDto, inboundUndismissBody, type InboundRowDto } from "@hub/contract/inbound";
import { notFound, v } from "../http";
import { INBOUND_OFF, projectReadOf, type InboundHandle } from "../inbound";
import { ownText } from "../apple-mail";

/** How the card reads a message's text from Mail (P96 verdict 6): null with the reason when Mail cannot show it. */
export type InboundTextReader = (account: string, messageId: string) => Promise<{ text: string } | { note: string }>;

/** The most rows the Inbox view lists (the bulk limit, verdict 7: Prepare all names at most this many). */
export const INBOX_LIST_MAX = 30;

const rowDto = (r: InboundRow & { messages?: number }): InboundRowDto => ({
  id: r.id,
  email: r.email,
  name: r.name,
  subject: r.subject,
  receivedAt: r.receivedAt,
  read: r.read,
  why: r.why,
  preview: r.preview,
  messages: r.messages ?? 1,
  threadDraftId: r.threadDraftId,
});

const id = (raw: string): number | null => (/^[1-9]\d*$/.test(raw) ? Number(raw) : null);

/**
 * The Inbox view of Mail (P96 S1): `GET /api/projects/:slug/inbound` (one row per client who wrote and has no draft yet, the
 * reader's line), `GET .../inbound/:id` (one message, its text read from Mail now), `POST .../inbound/check` (Check now: one
 * read pass, waited for), and No reply needed with its Undo (`POST .../inbound/:id/dismiss`, `POST .../inbound/undismiss`).
 * Read-only toward Mail, so the general loopback guard is enough (rules README 7); nothing here writes Mail or starts an agent.
 */
export function inboundRoutes(repos: Repos, reader: InboundHandle | undefined, readText: InboundTextReader | undefined) {
  const status = () => reader?.status() ?? INBOUND_OFF;
  const project = async (slug: string) => (await repos.projects.get(slug)) !== null;
  return new Hono()
    .get("/api/projects/:slug/inbound", async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      const rows = await repos.inboundMail.open(slug);
      return c.json(inboundListDto.parse({ rows: rows.slice(0, INBOX_LIST_MAX).map(rowDto), total: rows.length, read: projectReadOf(status(), slug) }));
    })
    .post("/api/projects/:slug/inbound/check", async (c) => {
      const slug = c.req.param("slug");
      if (!(await project(slug))) return notFound(c, "project");
      await reader?.tick();
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
    .get("/api/projects/:slug/inbound/:id", async (c) => {
      const slug = c.req.param("slug");
      const n = id(c.req.param("id"));
      const row = n === null ? null : await repos.inboundMail.get(slug, n);
      if (!row) return notFound(c, "message");
      const read = readText ? await readText(row.account, row.messageId).catch(() => ({ note: "Mail could not show this message." })) : { note: "Mail is not read here." };
      const own = "text" in read ? ownText(read.text) : null;
      const clientId = await repos.clients.idByEmail(slug, row.email);
      const drafts = clientId === undefined ? [] : (await repos.drafts.ofClient(slug, clientId)).sort((a, b) => b.id - a.id).slice(0, 10).map((d) => ({ id: d.id, subject: d.subject, status: d.status }));
      const others = (await repos.inboundMail.openOf(slug, row.email)).filter((r) => r.id !== row.id).slice(0, 10).map((r) => ({ id: r.id, subject: r.subject, receivedAt: r.receivedAt }));
      const notionUrl = (await repos.inbox.list(slug, "all")).find((r) => r.email === row.email)?.notionUrl ?? null;
      return c.json(
        inboundDetailDto.parse({
          row: { ...rowDto(row), account: row.account, mailbox: row.mailbox, messageId: row.messageId, open: row.open, dismissedAt: row.dismissedAt },
          text: own ? own.text : null,
          quoted: own?.quoted ?? false,
          note: "note" in read ? read.note : null,
          drafts,
          others,
          notionUrl,
        }),
      );
    });
}
