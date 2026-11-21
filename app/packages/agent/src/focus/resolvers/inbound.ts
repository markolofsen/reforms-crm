import { answeringDraft } from "@hub/db";
import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

/**
 * `inbound:10` (P98): a client's message the server's Mail reader stored (Mail ▸ Inbox), by its row id: who wrote, the subject and
 * when, so the agent never has to search Mail to guess it; the status says whether it waits or which draft answers it; read with
 * `inbound_show` (the Mail Message-ID, account and mailbox for `draft_write`). Another project's message names nothing.
 */
export const inbound: Resolver = async ({ repos, slug }, id) => {
  const row = await repos.inboundMail.get(slug, Number(id));
  if (!row) return null;
  const clientId = await repos.clients.idByEmail(slug, row.email);
  const answer = clientId === undefined ? null : answeringDraft(row, await repos.drafts.ofClient(slug, clientId));
  const status = row.open ? "waiting for a reply" : answer ? `answered by draft ${answer.id} (${answer.status})` : row.dismissedAt ? "no reply needed" : "closed";
  return { title: cut(`${row.name} <${row.email}> · ${row.subject || "(no subject)"} · received ${row.receivedAt}`), status, read: { server: "hub", tool: "inbound_show", args: { inbound: row.id } } };
};
