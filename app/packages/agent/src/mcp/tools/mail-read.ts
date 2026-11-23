import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CLIENT_FILTERS } from "@hub/config";
import { answeringDraft } from "@hub/db";
import { displayNameFor, headersFromText, resolveBrand, signatureFor, type HeaderAddresses } from "@hub/projects/brand";
import { configOf, type ToolCtx } from "../ports";
import { cut, DATA, READ_ONLY, run, ToolError } from "../result";

// The read-only Mail tools of `hub mcp`: one client, one Inbox message (P98), the Mail list, and the brand of an inbound
// from its headers (P60 `mail_brand`, no Mail read).

export function registerMailReadTools(server: McpServer, { repos, env, project }: ToolCtx): void {
  server.registerTool(
    "client_show",
    {
      title: "One client of this project",
      description: `A client by id or by email: marks, reply state, last contact, and their drafts (id, status, subject). Only clients the agent recorded exist here (the Hub is not a client directory; Notion is the CRM). ${DATA}`,
      inputSchema: z.object({ id: z.number().int().positive().optional(), email: z.string().max(320).optional() }),
      annotations: READ_ONLY,
    },
    ({ id, email }) =>
      run(async () => {
        const slug = project();
        const cid = id ?? (email ? await repos.clients.idByEmail(slug, email.trim()) : undefined);
        if (cid === undefined) throw new ToolError("invalid", "Give the client's id or email.");
        const c = await repos.clients.card(slug, cid);
        if (!c) throw new ToolError("not_found", `No client ${id ?? email} in project ${slug}.`);
        const drafts = await repos.drafts.ofClient(slug, c.id);
        const notion = drafts.find((d) => d.notionUrl)?.notionUrl ?? null;
        return { ...c, name: cut(c.name), project: slug, notion, drafts: drafts.slice(0, 30).map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), createdAt: d.createdAt })) };
      }),
  );

  // P98: a client's message in Mail ▸ Inbox (`inbound:<id>` in the focus): who, what and when, where mail-mcp opens it, and the
  // draft_write call that answers it, so the agent never searches Mail to guess which message the owner means.
  server.registerTool(
    "inbound_show",
    {
      title: "One client message of this project's Inbox",
      description: `A message the Hub's Mail reader stored for this project (focus ref \`inbound:<id>\`, Mail ▸ Inbox): from (name and address), subject, when it arrived, the Mail Message-ID, \`inbound\` (account, mailbox_path, message_id: mail-mcp get_message_content reads the full text, and draft_write takes the same three for a new reply), the preview, whether it still waits (\`open\`), the draft that answers it, if any, and the client's drafts. "Prepare reply" / "ответь" on it is a work order: write the reply with \`draft_write\` at once (\`reply\` gives the call), then record it; never ask first. ${DATA}`,
      inputSchema: z.object({ inbound: z.number().int().positive().describe("The message's id, as the focus ref inbound:<id> gives it.") }),
      annotations: READ_ONLY,
    },
    ({ inbound }) =>
      run(async () => {
        const slug = project();
        const row = await repos.inboundMail.get(slug, inbound);
        if (!row) throw new ToolError("not_found", `No message ${inbound} in project ${slug}'s Inbox.`);
        const clientId = await repos.clients.idByEmail(slug, row.email);
        const drafts = clientId === undefined ? [] : await repos.drafts.ofClient(slug, clientId);
        const answer = answeringDraft(row, drafts);
        const pm = env.projectMail?.(slug);
        const found = env.drafts && pm ? await env.drafts.findInbound(pm.accounts, row.messageId).catch(() => null) : null;
        return {
          id: row.id,
          project: slug,
          from: { name: cut(row.name), email: row.email },
          subject: cut(row.subject, 300),
          receivedAt: row.receivedAt,
          messageIdHeader: row.messageId,
          account: row.account,
          mailbox: row.mailbox,
          preview: row.preview,
          why: row.why,
          open: row.open,
          dismissedAt: row.dismissedAt,
          inbound: found ? { account: found.account, mailbox_path: found.mailboxPath, message_id: found.messageId } : null,
          answer: answer ? { id: answer.id, status: answer.status, subject: cut(answer.subject), createdAt: answer.createdAt } : null,
          client: clientId === undefined ? null : { id: clientId },
          drafts: drafts.slice(0, 10).map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), createdAt: d.createdAt })),
          reply: answer
            ? { note: `Draft ${answer.id} already answers it: revise that one with draft_write { draft: ${answer.id} } when asked.` }
            : found
              ? { draft_write: { account: found.account, mailbox_path: found.mailboxPath, message_id: found.messageId, content: "<the reply>" }, then: "record it: ./run.sh record-draft with mailRef = messageIdHeader" }
              : { note: "Mail did not find the message now: find it with mail-mcp find_messages by its Message-ID (messageIdHeader), then draft_write." },
        };
      }),
  );

  server.registerTool(
    "drafts_list",
    {
      title: "The Mail list of this project (its drafts)",
      description: `The rows the admin's Mail list shows: the newest draft of each client, in the admin's order. view: one of ${CLIENT_FILTERS.join(", ")} (default ready). ${DATA}`,
      inputSchema: z.object({ view: z.enum(CLIENT_FILTERS).optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).optional() }),
      annotations: READ_ONLY,
    },
    ({ view, q, limit }) =>
      run(async () => {
        const slug = project();
        const filter = view ?? "ready";
        const opts = q ? { search: q } : {};
        const [rows, total] = await Promise.all([repos.clients.review(slug, filter, { ...opts, limit: limit ?? 20 }), repos.clients.reviewTotal(slug, filter, opts)]);
        return { project: slug, view: filter, total, drafts: rows.map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), client: { id: d.client.id, name: cut(d.client.name), email: d.client.email, repliesOwed: d.client.repliesOwed }, evidence: d.evidence ?? null, repliedElsewhere: d.repliedElsewhere, teamSent: d.teamSent })) };
      }),
  );

  server.registerTool(
    "mail_brand",
    {
      title: "Which brand a client wrote to",
      description: `The project's address the client wrote to (clientWroteTo: an address of ours, never the From of the reply) and its ## Brands row (brand), from the inbound's headers: pass \`headers\` = the allHeaders text of mail-mcp get_message_content (and its to and cc fields when it gives them separately). No Mail read. The order is fixed (X-Gm-Original-To, X-Original-To, X-Forwarded-For, X-Forwarded-To, Delivered-To, To, Cc; the project's account addresses only when nothing else matches), so never re-derive it from Delivered-To yourself. Use brand for the Notion Brand column and for knowledge_search; null brand means unbranded: say so, never guess. The draft's signature is added by draft_write, not by you. ${DATA}`,
      inputSchema: z.object({
        headers: z.string().max(40_000).optional().describe("The raw header block (allHeaders) of the client's message."),
        to: z.array(z.string().max(320)).max(50).optional().describe("The message's To addresses, when given apart from the headers."),
        cc: z.array(z.string().max(320)).max(50).optional().describe("The message's Cc addresses, when given apart from the headers."),
      }),
      annotations: READ_ONLY,
    },
    ({ headers, to, cc }) =>
      run(async () => {
        const slug = project();
        const id = env.projectMail?.(slug).identity;
        if (!env.projectMail || !id) throw new ToolError("unavailable", "This hub MCP server has no project identity to resolve a brand with.");
        const list: HeaderAddresses[] = [...headersFromText(headers ?? "")];
        if (to?.length && !list.some((h) => h.name === "to")) list.push({ name: "to", addresses: to });
        if (cc?.length && !list.some((h) => h.name === "cc")) list.push({ name: "cc", addresses: cc });
        const cfg = configOf(env.projectMail(slug));
        const r = resolveBrand(list, cfg);
        const sig = signatureFor(cfg, r);
        const { wroteTo, ...rest } = r;
        return { project: slug, clientWroteTo: wroteTo, ...rest, brands: cfg.brands.map((b) => b.name), brandDisplayName: displayNameFor(cfg, r.brand), signature: sig.placeholder ? "placeholder" : sig.lines.length ? "signed" : "none" };
      }),
  );
}
