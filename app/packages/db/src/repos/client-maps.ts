import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { clientMaps, clients } from "../schema";

// P135 verdict 1: the client map lives in the Hub. `clients.map` is the current text, `client_maps` every version (a rebuild
// never loses the previous one). The text is checked by `@hub/diagram/map` before it reaches here; this repository stores it.
// Only a client the Hub already recorded has a map (decision 0009: the database is not a client directory).
// P136 (migration 0037): each version keeps its evidence (`sources`, node id -> refs) and the reasons for the nodes it removed or
// renamed (`reasons`, node id -> why), as the tool checked them; a version drawn before P136 has neither.

export type MapSources = Record<string, string[]>;
export type MapReasons = Record<string, string>;

export interface ClientMap {
  clientId: number;
  email: string;
  name: string;
  source: string | null;
  updatedAt: string | null;
  /** The version before the current one, for the sheet's diff. */
  previous: { source: string; at: string } | null;
  versions: number;
  /** P136: the current version's evidence and reasons, null when it was drawn before P136. */
  sources: MapSources | null;
  reasons: MapReasons | null;
}

export interface ClientMapSaved { clientId: number; email: string; updatedAt: string; versions: number; unchanged: boolean }

/** P136 Q7: one client's map history for the stuck list: the newest versions first. */
export interface ClientMapHistory { clientId: number; email: string; name: string; versions: Array<{ source: string; at: string }> }

/** P136 Q4: a client active lately whose map is missing or old (skill `review-maps`). */
export interface MapDue { clientId: number; email: string; name: string; lastContactAt: string; mapUpdatedAt: string | null }

const countOf = (q: Pick<Db, "select">, project: string, clientId: number): number =>
  q.select({ n: sql<number>`count(*)` }).from(clientMaps).where(and(eq(clientMaps.project, project), eq(clientMaps.clientId, clientId))).get()?.n ?? 0;

/** A stored JSON object, or null when it is absent or not an object (never throws). */
function objectOf<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

const DAY = 86_400_000;

export function clientMapsRepo(db: Db) {
  return {
    /** The client's map with the version before it; null when the project has no such client. Read only. */
    async get(project: string, clientId: number): Promise<ClientMap | null> {
      const c = db.select({ id: clients.id, email: clients.email, name: clients.name, map: clients.map, mapUpdatedAt: clients.mapUpdatedAt }).from(clients).where(and(eq(clients.project, project), eq(clients.id, clientId))).get();
      if (!c) return null;
      const rows = db.select({ source: clientMaps.source, at: clientMaps.createdAt, sources: clientMaps.sources, reasons: clientMaps.reasons }).from(clientMaps).where(and(eq(clientMaps.project, project), eq(clientMaps.clientId, clientId))).orderBy(desc(clientMaps.id)).limit(2).all();
      const head = rows[0];
      const prev = rows[1];
      return {
        clientId: c.id,
        email: c.email,
        name: c.name,
        source: c.map,
        updatedAt: c.mapUpdatedAt,
        previous: prev ? { source: prev.source, at: prev.at } : null,
        versions: countOf(db, project, clientId),
        sources: objectOf<MapSources>(head?.sources ?? null),
        reasons: objectOf<MapReasons>(head?.reasons ?? null),
      };
    },

    /**
     * Saves a new whole map (a redraw, never an append): the current text and a version row with its evidence and reasons, in one
     * transaction. The same text as the current one is not a new version (`unchanged`), so a rerun of a session adds nothing.
     */
    async save(project: string, clientId: number, source: string, now: Date = new Date(), extra: { sources?: MapSources; reasons?: MapReasons } = {}): Promise<ClientMapSaved | null> {
      return write(db, (tx) => {
        const c = tx.select({ id: clients.id, email: clients.email, map: clients.map, mapUpdatedAt: clients.mapUpdatedAt }).from(clients).where(and(eq(clients.project, project), eq(clients.id, clientId))).get();
        if (!c) return null;
        const versions = () => countOf(tx, project, clientId);
        if (c.map === source && c.mapUpdatedAt) return { clientId, email: c.email, updatedAt: c.mapUpdatedAt, versions: versions(), unchanged: true };
        const at = now.toISOString();
        const reasons = extra.reasons && Object.keys(extra.reasons).length ? JSON.stringify(extra.reasons) : null;
        tx.insert(clientMaps).values({ project, clientId, source, createdAt: at, sources: extra.sources ? JSON.stringify(extra.sources) : null, reasons }).run();
        tx.update(clients).set({ map: source, mapUpdatedAt: at, updatedAt: at }).where(eq(clients.id, clientId)).run();
        return { clientId, email: c.email, updatedAt: at, versions: versions(), unchanged: false };
      });
    },

    /**
     * P136 Q7: every client of the project that has a map, with its newest `perClient` versions (newest first), for the stuck
     * list (blocked, or waiting a week). Read only.
     */
    async histories(project: string, perClient = 12): Promise<ClientMapHistory[]> {
      const cs = db.select({ id: clients.id, email: clients.email, name: clients.name }).from(clients).where(and(eq(clients.project, project), isNotNull(clients.map))).all();
      if (!cs.length) return [];
      const rows = db.select({ clientId: clientMaps.clientId, source: clientMaps.source, at: clientMaps.createdAt }).from(clientMaps).where(and(eq(clientMaps.project, project), inArray(clientMaps.clientId, cs.map((c) => c.id)))).orderBy(desc(clientMaps.id)).all();
      const by = new Map<number, Array<{ source: string; at: string }>>();
      for (const r of rows) {
        const list = by.get(r.clientId) ?? [];
        if (list.length < perClient) list.push({ source: r.source, at: r.at });
        by.set(r.clientId, list);
      }
      return cs.map((c) => ({ clientId: c.id, email: c.email, name: c.name, versions: by.get(c.id) ?? [] }));
    },

    /**
     * P136 Q4 (verdict 6): the clients whose last contact is within `activeDays` and whose map is missing or older than `staleDays`,
     * most recent contact first: the weekly review redraws exactly these. Read only.
     */
    async due(project: string, now: Date = new Date(), o: { activeDays?: number; staleDays?: number; limit?: number } = {}): Promise<MapDue[]> {
      const active = new Date(now.getTime() - (o.activeDays ?? 30) * DAY).toISOString();
      const stale = new Date(now.getTime() - (o.staleDays ?? 7) * DAY).toISOString();
      const rows = db
        .select({ clientId: clients.id, email: clients.email, name: clients.name, lastContactAt: clients.lastContactAt, mapUpdatedAt: clients.mapUpdatedAt })
        .from(clients)
        .where(and(eq(clients.project, project), sql`${clients.lastContactAt} >= ${active}`, sql`(${clients.mapUpdatedAt} IS NULL OR ${clients.mapUpdatedAt} < ${stale})`))
        .orderBy(desc(clients.lastContactAt))
        .limit(o.limit ?? 50)
        .all();
      return rows.flatMap((r) => (r.lastContactAt ? [{ ...r, lastContactAt: r.lastContactAt }] : []));
    },
  };
}
