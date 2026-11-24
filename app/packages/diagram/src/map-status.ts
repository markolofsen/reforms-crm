// P136: what a client map says about where the client stands, read from checked maps: the counts of its states (the
// conversation header's line), the nodes that hold the client up across versions (Overview's "Where we are stuck") and its next
// step (the Notion profile's `Next step`). Pure, the same in Node and the browser.
import { checkClientMap, mapOutline, type MapClass, type MapGraph, type MapNode } from "./map";

/** How many nodes hold each state (the conversation header's "Map · 3 open · 1 waiting"). */
export function mapCounts(g: Pick<MapGraph, "nodes">): Record<MapClass, number> {
  const out: Record<MapClass, number> = { open: 0, waiting: 0, done: 0, blocked: 0 };
  for (const n of g.nodes) if (n.cls) out[n.cls] += 1;
  return out;
}

/** A node that holds the client up (P136 verdict 7f): `blocked`, or `waiting` since `since` (the oldest version it waited in). */
export interface StuckNode { id: string; label: string; state: "blocked" | "waiting"; since: string }

/**
 * The blocked nodes of the newest version, and its waiting nodes that have waited at least `days` (P136 verdict 7f). `versions`
 * newest first; a node's `since` is the drawing time of the oldest version, in the unbroken run back from the newest, in which it
 * held the same state. Versions that do not read are skipped. Pure: `now` is the caller's.
 */
export function stuckNodes(versions: ReadonlyArray<{ source: string; at: string }>, now: number, days = 7): StuckNode[] {
  const graphs = versions.map((v) => ({ at: v.at, g: checkClientMap(v.source, { sources: "optional" }) })).flatMap((v) => (v.g.ok ? [{ at: v.at, g: v.g }] : []));
  const head = graphs[0];
  if (!head) return [];
  const out: StuckNode[] = [];
  for (const n of head.g.nodes) {
    if (n.cls !== "blocked" && n.cls !== "waiting") continue;
    let since = head.at;
    for (const v of graphs.slice(1)) {
      if (v.g.nodes.find((m) => m.id === n.id)?.cls !== n.cls) break;
      since = v.at;
    }
    const age = now - Date.parse(since);
    if (n.cls === "blocked" || age >= days * 86_400_000) out.push({ id: n.id, label: n.label, state: n.cls, since });
  }
  return out;
}

const ISO_DAY = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * P136 verdict 5: the client's next step as the map says it, for the Notion profile's `Next step`: the open leaf whose label holds
 * the nearest (earliest) ISO date, else the first open leaf in outline order, else the first waiting one; null when nothing is
 * open. Pure.
 */
export function nextStepOf(g: MapGraph): string | null {
  const parents = new Set(g.edges.map((e) => e.from));
  const order = mapOutline(g).map((l) => l.id);
  const leaves = g.nodes.filter((n) => n.id !== g.root && !parents.has(n.id));
  const inOrder = (list: MapNode[]) => [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const open = inOrder(leaves.filter((n) => n.cls === "open"));
  const dated = open.flatMap((n) => {
    const d = ISO_DAY.exec(n.label)?.[1];
    return d ? [{ n, d }] : [];
  });
  dated.sort((a, b) => a.d.localeCompare(b.d));
  return dated[0]?.n.label ?? open[0]?.label ?? inOrder(leaves.filter((n) => n.cls === "waiting"))[0]?.label ?? null;
}
