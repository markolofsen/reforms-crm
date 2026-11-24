import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../client";
import { ownerFixes } from "../schema";

export type OwnerFixRow = typeof ownerFixes.$inferSelect;
export type NewOwnerFix = Omit<OwnerFixRow, "id">;

/** How long a refusal stays on Overview without a successful call of its tool (P129 verdict 11). */
export const OWNER_FIX_HOURS = 24;

/** The refusals only the owner can fix (P129 verdict 11): written by `hub mcp`, read by Overview's Needs you. */
export function ownerFixesRepo(db: Db) {
  return {
    /** The newest refusal of this code in the project replaces the one before. */
    async note(r: NewOwnerFix): Promise<void> {
      db.insert(ownerFixes).values(r).onConflictDoUpdate({ target: [ownerFixes.project, ownerFixes.code], set: { tool: r.tool, line: r.line, place: r.place, at: r.at } }).run();
    },
    /** Whether a refusal of this tool waits (a read, so a successful call opens no write connection when none does). */
    async anyFor(project: string, tool: string): Promise<boolean> {
      return db.select({ id: ownerFixes.id }).from(ownerFixes).where(and(eq(ownerFixes.project, project), eq(ownerFixes.tool, tool))).limit(1).get() !== undefined;
    },
    /** A successful call of the tool: its refusals are answered. */
    async clear(project: string, tool: string): Promise<void> {
      db.delete(ownerFixes).where(and(eq(ownerFixes.project, project), eq(ownerFixes.tool, tool))).run();
    },
    /** The project's refusals of the last 24 hours, newest first. */
    async active(project: string, now: Date = new Date()): Promise<OwnerFixRow[]> {
      const since = new Date(now.getTime() - OWNER_FIX_HOURS * 3_600_000).toISOString();
      return db.select().from(ownerFixes).where(and(eq(ownerFixes.project, project), gte(ownerFixes.at, since))).all().sort((a, b) => b.at.localeCompare(a.at));
    },
  };
}
