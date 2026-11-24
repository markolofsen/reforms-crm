import { and, eq, inArray, sql } from "drizzle-orm";
import { betterValue } from "@hub/config/profile";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { write } from "../tx";
import { agentRuns, clients, drafts, enrollments } from "../schema";
import { insertEvent } from "./runs";

/**
 * P141 C4: a client known only by a chat gets its email later, and that email is another client row's. The two become one: every
 * row that names the chat-only client (its identifiers, mail and messenger drafts, the follow-up enrollments, the marks, the map
 * versions, the agent's events) moves to the client that has the email, its name and Notion card move only by the profile rule
 * (`betterValue`), and the old row stays with `merged_into`, so a lookup that still finds it is followed to the survivor. One
 * transaction, one Activity line. Refused when both hold an open mail draft or an open follow-up, which one person cannot have twice.
 */
export function clientMergeRepo(db: Db) {
  return {
    /** C4: the Email of a client that has none (never a replacement: the profile rule). Returns whether it was written. */
    async setEmailIfEmpty(project: string, id: number, email: string, at: string = new Date().toISOString()): Promise<boolean> {
      return write(db, (tx) => tx.update(clients).set({ email, updatedAt: at }).where(and(eq(clients.project, project), eq(clients.id, id), sql`${clients.email} is null`)).run().changes > 0);
    },
    /** C5: a client's name, only when the profile rule calls it better than the stored one (a real name over a number). */
    async renameIfBetter(project: string, id: number, name: string, at: string = new Date().toISOString()): Promise<boolean> {
      return write(db, (tx) => {
        const cur = tx.select({ name: clients.name }).from(clients).where(and(eq(clients.project, project), eq(clients.id, id))).get();
        const next = cur ? betterValue("title", cur.name, name) : null;
        return next ? tx.update(clients).set({ name: next, updatedAt: at }).where(eq(clients.id, id)).run().changes > 0 : false;
      });
    },
    async merge(project: string, fromId: number, intoId: number, o: { by: string; at?: string }): Promise<{ into: number; moved: number }> {
      const at = o.at ?? new Date().toISOString();
      return write(db, (tx) => {
        if (fromId === intoId) throw new RepoError("wrong_state", "A client cannot be merged into itself.");
        const rows = tx.select().from(clients).where(and(eq(clients.project, project), inArray(clients.id, [fromId, intoId]))).all();
        const from = rows.find((r) => r.id === fromId);
        const into = rows.find((r) => r.id === intoId);
        if (!from || !into) throw new RepoError("not_found", "No such client in this project.");
        if (from.mergedInto !== null || into.mergedInto !== null) throw new RepoError("wrong_state", "One of the two clients was merged already.");
        const openDrafts = tx.select({ c: drafts.clientId }).from(drafts).where(and(inArray(drafts.clientId, [fromId, intoId]), inArray(drafts.status, ["ready", "hold"]))).all();
        if (new Set(openDrafts.map((r) => r.c)).size === 2) throw new RepoError("wrong_state", "Both clients have an open mail draft: finish or skip one first.");
        const openFollowUps = tx.select({ c: enrollments.clientId }).from(enrollments).where(and(eq(enrollments.project, project), inArray(enrollments.clientId, [fromId, intoId]), inArray(enrollments.state, ["active", "paused"]))).all();
        if (new Set(openFollowUps.map((r) => r.c)).size === 2) throw new RepoError("wrong_state", "Both clients are in an open follow-up: stop one first.");

        let moved = 0;
        // Literal table names (rule 15): one UPDATE per table that names a client.
        for (const table of ["client_identifiers", "messenger_drafts", "drafts", "enrollments", "client_maps", "agent_events"] as const) {
          moved += tx.run(sql`update ${sql.raw(table)} set client_id = ${intoId} where client_id = ${fromId} and project = ${project}`).changes;
        }
        tx.run(sql`insert or ignore into marks (project, client_id, mark, created_at) select project, ${intoId}, mark, created_at from marks where client_id = ${fromId}`);
        tx.run(sql`delete from marks where client_id = ${fromId}`);

        // The survivor takes what it lacks (never a replacement); the unique columns leave the old row first.
        const email = betterValue("email", into.email, from.email);
        const page = into.notionPageId ? null : from.notionPageId;
        const name = betterValue("title", into.name, from.name);
        tx.update(clients).set({ mergedInto: intoId, updatedAt: at, ...(email ? { email: null } : {}), ...(page ? { notionPageId: null } : {}) }).where(eq(clients.id, fromId)).run();
        if (email || page || name) tx.update(clients).set({ updatedAt: at, ...(email ? { email } : {}), ...(page ? { notionPageId: page } : {}), ...(name ? { name } : {}) }).where(eq(clients.id, intoId)).run();

        const run = tx.insert(agentRuns).values({ project, startedAt: at, finishedAt: at, trigger: "owner", skill: null, status: "ok" }).returning({ id: agentRuns.id }).get();
        const label = (r: typeof from) => r.name || r.email || `client ${r.id}`;
        // Activity's outcome `linked` (All only): the chats of the old row are now this client's.
        const why = `Merged ${label(from)} into ${label(into)}: its chats, drafts and history are this client's now (by ${o.by}).`;
        insertEvent(tx, { project, runId: run.id, at, kind: "decision", tool: null, summary: `${label(into)}: merged`, detail: JSON.stringify({ action: "linked", reason: why, merged: { from: fromId, into: intoId, moved } }), clientId: intoId });
        return { into: intoId, moved };
      });
    },
  };
}
