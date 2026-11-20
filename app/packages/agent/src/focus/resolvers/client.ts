import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

/** `client:7`: the name and address; read with `client_show`. */
export const client: Resolver = async ({ repos, slug }, id) => {
  const c = await repos.clients.get(slug, Number(id));
  return c ? { title: cut(`${c.name || c.email} <${c.email}>`), status: null, read: { server: "hub", tool: "client_show", args: { id: c.id } } } : null;
};
