import { mapCounts, parseSourceRef, type MapClass, type MapGraph } from "@hub/diagram/map";

/**
 * P136 verdict 7c: which messages of the open thread a map node rests on. A node's refs (its `%% src` line) are Message-IDs or
 * "YYYY-MM-DD channel"; a Mail message matches its Message-ID (angle brackets and case aside) or a `mail` day, a chat message a
 * day of its chat's channel. Pure: the panes pass their messages, the sheet the refs. Keys come back in thread order.
 */
export type ThreadMessage = { key: string; at: string; channel: string; messageId?: string | null };

const norm = (id: string): string => id.trim().replace(/^<(.*)>$/, "$1").toLowerCase();

export function matchSources(refs: readonly string[], messages: readonly ThreadMessage[]): string[] {
  const parsed = refs.map(parseSourceRef).filter((r) => r !== null);
  const ids = new Set(parsed.flatMap((r) => (r.kind === "message" ? [norm(r.id)] : [])));
  const days = new Set(parsed.flatMap((r) => (r.kind === "day" ? [`${r.day} ${r.channel}`] : [])));
  return messages.filter((m) => (m.messageId ? ids.has(norm(m.messageId)) : false) || days.has(`${m.at.slice(0, 10)} ${m.channel}`)).map((m) => m.key);
}

/** The words of the four states, said beside every colour (accessibility rule 6). */
export const MAP_STATE_WORDS: Record<MapClass, string> = { open: "Open", waiting: "Waiting", done: "Done", blocked: "Blocked" };

/** The header line's counts (P136 verdict 7a): "3 open · 1 waiting · 1 blocked", or "all done"; the states with none are left out. */
export function mapSummary(g: Pick<MapGraph, "nodes">): string {
  const c = mapCounts(g);
  const parts = (["open", "waiting", "blocked"] as const).filter((s) => c[s] > 0).map((s) => `${c[s]} ${s}`);
  return parts.length ? parts.join(" · ") : c.done > 0 ? "all done" : "no states";
}
