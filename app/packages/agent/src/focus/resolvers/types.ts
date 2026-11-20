import type { FocusItem } from "@hub/contract/focus";
import type { Repos } from "@hub/db";

/** What a resolver reads with: the database (read-only for `hub mcp` and the hook), the bound project, and today (UTC day). */
export interface ResolveCtx {
  repos: Repos;
  slug: string;
  today: string;
}

/** One ref kind's id into its title, status and read tool, inside `ctx.slug` only; null when it names nothing there. */
export type Resolver = (ctx: ResolveCtx, id: string) => Promise<Omit<FocusItem, "ref" | "kind"> | null>;
