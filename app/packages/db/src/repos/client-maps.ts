import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { clientMaps, clients } from "../schema";

// P135 verdict 1: the client map lives in the Hub. `clients.map` is the current text, `client_maps` every version (a rebuild
// never loses the previous one). The text is checked by `@hub/diagram/map` before it reaches here; this repository stores it.
// Only a client the Hub already recorded has a map (decision 0009: the database is not a client directory).

export interface ClientMap {
  clientId: number;
  email: string;
  name: string;
  source: string | null;
  updatedAt: string | null;
  /** The version before the current one, for the sheet's "Previous" toggle. */
  previous: { source: string; at: string } | null;
  versions: number;
}

export interface ClientMapSaved { clientId: number; email: string; updatedAt: string; versions: number; unchanged: boolean }

const countOf = (q: Pick<Db, "select">, project: string, clientId: number): number =>
  q.select({ n: sql<number>`count(*)` }).from(clientMaps).where(and(eq(clientMaps.project, project), eq(clientMaps.clientId, clientId))).get()?.n ?? 0;

export function clientMapsRepo(db: Db) {
  return {
    /** The client's map with the version before it; null when the project has no such client. Read only. */
    async get(project: string, clientId: number): Promise<ClientMap | null> {
      const c = db.select({ id: clients.id, email: clients.email, name: clients.name, map: clients.map, mapUpdatedAt: clients.mapUpdatedAt }).from(clients).where(and(eq(clients.project, project), eq(clients.id, clientId))).get();
      if (!c) return null;
      const rows = db.select({ source: clientMaps.source, at: clientMaps.createdAt }).from(clientMaps).where(and(eq(clientMaps.project, project), eq(clientMaps.clientId, clientId))).orderBy(desc(clientMaps.id)).limit(2).all();
      return { clientId: c.id, email: c.email, name: c.name, source: c.map, updatedAt: c.mapUpdatedAt, previous: rows[1] ?? null, versions: countOf(db, project, clientId) };
    },

    /**
     * Saves a new whole map (a redraw, never an append): the current text and a version row, in one transaction. The same text
     * as the current one is not a new version (`unchanged`), so a rerun of a session adds nothing.
     */
    async save(project: string, clientId: number, source: string, now: Date = new Date()): Promise<ClientMapSaved | null> {
      return write(db, (tx) => {
        const c = tx.select({ id: clients.id, email: clients.email, map: clients.map, mapUpdatedAt: clients.mapUpdatedAt }).from(clients).where(and(eq(clients.project, project), eq(clients.id, clientId))).get();
        if (!c) return null;
        const versions = () => countOf(tx, project, clientId);
        if (c.map === source && c.mapUpdatedAt) return { clientId, email: c.email, updatedAt: c.mapUpdatedAt, versions: versions(), unchanged: true };
        const at = now.toISOString();
        tx.insert(clientMaps).values({ project, clientId, source, createdAt: at }).run();
        tx.update(clients).set({ map: source, mapUpdatedAt: at, updatedAt: at }).where(eq(clients.id, clientId)).run();
        return { clientId, email: c.email, updatedAt: at, versions: versions(), unchanged: false };
      });
    },
  };
}
