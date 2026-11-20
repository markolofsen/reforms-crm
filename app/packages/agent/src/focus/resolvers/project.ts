import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

/** `project:<slug>` (Overview's rows): the bound project only; another project's row names nothing (isolation). */
export const project: Resolver = async ({ repos, slug }, id) => {
  if (id !== slug) return null;
  const p = await repos.projects.get(slug);
  return p ? { title: cut(p.name || p.slug), status: p.status, read: null } : null;
};
