import { cut } from "../../mcp-result";
import type { Resolver } from "./types";

/**
 * `run:10`: one agent session of Activity, by its skill (or trigger) and start; its status. No hub tool reads a run's rows yet,
 * so `read` is null: the title and status are what the focus says of it.
 */
export const run: Resolver = async ({ repos, slug }, id) => {
  const r = await repos.runs.get(slug, Number(id));
  return r ? { title: cut(`run ${r.id} · ${r.skill ?? r.trigger} · started ${r.startedAt.slice(0, 16).replace("T", " ")}`), status: r.status, read: null } : null;
};
