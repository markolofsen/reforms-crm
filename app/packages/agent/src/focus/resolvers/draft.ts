import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

/** `draft:42`: the client and the subject, its status; read with `draft_show`. Another project's draft names nothing. */
export const draft: Resolver = async ({ repos, slug }, id) => {
  const d = await repos.drafts.get(Number(id));
  if (!d || d.project !== slug) return null;
  const c = await repos.clients.get(slug, d.clientId);
  if (!c) return null;
  return { title: cut(`${c.name || c.email} <${c.email}> · ${d.subject}`), status: d.status, read: { server: "hub", tool: "draft_show", args: { draft: d.id } } };
};
