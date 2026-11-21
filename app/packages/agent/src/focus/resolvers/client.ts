import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

const hhmm = (iso: string): string => iso.slice(11, 16);
const STATE: Record<string, string> = { wrote: "wrote you", draft: "draft ready", hold: "draft on hold", waiting: "waiting for them", done: "done" };

/**
 * `client:7`: a person, and since P99 (verdict 11) their conversation in Mail (`/mail/c/7`). The title names the open draft and
 * their newest message, e.g. "Mark Effect <m@x> · draft 4 ready · their newest: Re: Wow 01:23", so a "this" in the dock lands on
 * the right draft; the status is the state word. Read with `client_show`, and the open draft with `draft_show`.
 */
export const client: Resolver = async ({ repos, slug }, id) => {
  const c = await repos.clients.get(slug, Number(id));
  if (!c) return null;
  const row = await repos.conversations.one(slug, c.id);
  const parts = [`${c.name || c.email} <${c.email}>`];
  if (row?.draft) parts.push(`draft ${row.draft.id} ${row.draft.status === "hold" ? "on hold" : "ready"}`);
  const theirs = row?.theirLastAt ? (await repos.conversations.facts(slug, c.id))?.inbound[0] : undefined;
  if (theirs) parts.push(`their newest: ${theirs.subject || "(no subject)"} ${theirs.receivedAt.slice(0, 10)} ${hhmm(theirs.receivedAt)}`);
  const args: Record<string, number> = row?.draft ? { draft: row.draft.id } : { id: c.id };
  return { title: cut(parts.join(" · ")), status: row ? (STATE[row.state] ?? null) : null, read: { server: "hub", tool: row?.draft ? "draft_show" : "client_show", args } };
};
