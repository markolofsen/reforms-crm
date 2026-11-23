import { entryStatus } from "@hub/contract/knowledge";
import { cut } from "../../mcp/result";
import type { Resolver } from "./types";

/** `knowledge:<index path>`: the entry's title and status; read with knowledge-mcp `knowledge_get` by the same path. */
export const knowledge: Resolver = async ({ repos, slug, today }, path) => {
  const k = await repos.knowledge.get(slug, path);
  return k ? { title: cut(k.title), status: entryStatus(k, today), read: { server: "knowledge-mcp", tool: "knowledge_get", args: { project: slug, path: k.path } } } : null;
};
