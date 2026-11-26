import { answeringDraft } from "@hub/db";
import { LEAD_PASS_DECISION_LABELS, LEAD_PASS_DISPLAY_LABELS, leadPassDisplay } from "@hub/config/lead-pass";
import { cut } from "../../mcp/result";
import type { Resolver } from "./types";

/**
 * `inbound:10` (P98): a client's message the server's Mail reader stored (Mail ▸ Inbox), by its row id: who wrote, the subject and
 * when, so the agent never has to search Mail to guess it; the status says whether it waits or which draft answers it; read with
 * `message_show` (the Mail Message-ID, account and mailbox, the brand it was written to, P129 A4). Another project's message names nothing.
 */
export const inbound: Resolver = async ({ repos, slug }, id) => {
  const row = await repos.inboundMail.get(slug, Number(id));
  if (!row) return null;
  const clientId = await repos.clients.findByIdentity(slug, "email", row.email);
  const answer = clientId === undefined ? null : answeringDraft(row, await repos.drafts.ofClient(slug, clientId));
  const status = row.open ? "waiting for a reply" : answer ? `answered by draft ${answer.id} (${answer.status})` : row.dismissedAt ? "no reply needed" : "closed";
  return { title: cut(`${row.name} <${row.email}> · ${row.subject || "(no subject)"} · received ${row.receivedAt}`), status, read: { server: "hub", tool: "message_show", args: { inbound: row.id } } };
};

/** A Notion lead's page id, resolved only within the session's project, including manual decisions and history. */
export const lead: Resolver = async ({ repos, slug }, id) => {
  const row = await repos.leadRows.get(slug, id);
  if (!row) return null;
  const display = leadPassDisplay(row);
  const status = display === "proposed" && row.passDecision ? LEAD_PASS_DECISION_LABELS[row.passDecision] : LEAD_PASS_DISPLAY_LABELS[display];
  return { title: cut(`${row.name}${row.email ? ` <${row.email}>` : ""} · ${row.preview}`), status, read: null };
};
