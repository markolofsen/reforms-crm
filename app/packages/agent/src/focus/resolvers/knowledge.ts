import { entryStatus } from "@hub/contract/knowledge";
import { cut } from "../../mcp/result";
import type { Resolver } from "./types";

/** `knowledge:<index path>`: the entry's title and status; read with the hub's `knowledge_get` by the same path (P129 A4). */
export const knowledge: Resolver = async ({ repos, slug, today }, path) => {
  const k = await repos.knowledge.get(slug, path);
  return k ? { title: cut(k.title), status: entryStatus(k, today), read: { server: "hub", tool: "knowledge_get", args: { path: k.path } } } : null;
};
