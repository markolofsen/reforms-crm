import type { SqliteClient } from "@hub/db";
import { z } from "zod";

export const MEMBERSHIP_STATES = ["unknown", "not_member", "queued", "joining", "joined", "pending", "manual_required", "refused"] as const;
const Row = z.object({ project: z.string(), account: z.string(), group_username: z.string(), peer_id: z.string().nullable(), kind: z.enum(["group", "channel"]).nullable(),
  state: z.enum(MEMBERSHIP_STATES), checked_at: z.string().nullable(), joined_at: z.string().nullable(), queued_at: z.string().nullable(), next_attempt_at: z.string().nullable(), attempted_at: z.string().nullable(),
  reason: z.string().nullable(), generation: z.string().nullable(), request_ref: z.string().nullable() }).transform((r) => ({
  account: r.account, username: r.group_username, peerId: r.peer_id, kind: r.kind, state: r.state, checkedAt: r.checked_at, joinedAt: r.joined_at,
  queuedAt: r.queued_at, nextAttemptAt: r.next_attempt_at, attemptedAt: r.attempted_at, reason: r.reason, generation: r.generation, requestRef: r.request_ref,
}));
export type WatchMembership = z.infer<typeof Row>;
export type MembershipPatch = Partial<Omit<WatchMembership, "account" | "username">>;
const COLUMNS: Record<keyof MembershipPatch, string> = { peerId: "peer_id", kind: "kind", state: "state", checkedAt: "checked_at", joinedAt: "joined_at", queuedAt: "queued_at", nextAttemptAt: "next_attempt_at", attemptedAt: "attempted_at", reason: "reason", generation: "generation", requestRef: "request_ref" };

export interface MembershipStore {
  membership(account: string, username: string): WatchMembership | null;
  memberships(account: string): WatchMembership[];
  setMembership(account: string, username: string, patch: MembershipPatch, at: Date): void;
  claimMembership(account: string, username: string, generation: string, at: Date): boolean;
}

/** Project-scoped membership state and a transition audit; source cache and read-access columns are untouched. */
export function membershipStore(c: SqliteClient, project: string): MembershipStore {
  const get = (account: string, username: string): WatchMembership | null => {
    const row: unknown = c.prepare("SELECT * FROM memberships WHERE project=? AND account=? AND group_username=?").get(project, account, username);
    return row === undefined ? null : Row.parse(row);
  };
  const audit = (row: WatchMembership, at: Date) => c.prepare("INSERT INTO membership_events(project,account,group_username,at,state,generation,request_ref,reason) VALUES (?,?,?,?,?,?,?,?)")
    .run(project, row.account, row.username, at.toISOString(), row.state, row.generation, row.requestRef, row.reason);
  return {
    membership: get,
    memberships: (account) => c.prepare("SELECT * FROM memberships WHERE project=? AND account=? ORDER BY coalesce(queued_at,checked_at,''),group_username").all(project, account).map((r) => Row.parse(r)),
    setMembership(account, username, patch, at) {
      const keys = Object.keys(COLUMNS).filter((k): k is keyof MembershipPatch => k in patch);
      c.transaction(() => {
        const prior = get(account, username);
        c.prepare("INSERT INTO memberships(project,account,group_username) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(project, account, username);
        if (keys.length) c.prepare(`UPDATE memberships SET ${keys.map((k) => `${COLUMNS[k]}=?`).join(",")} WHERE project=? AND account=? AND group_username=?`).run(...keys.map((k) => patch[k] ?? null), project, account, username);
        const next = get(account, username);
        if (next && (next.state !== prior?.state || next.generation !== prior?.generation)) audit(next, at);
      })();
    },
    claimMembership(account, username, generation, at) {
      return c.transaction(() => {
        const changed = c.prepare("UPDATE memberships SET state='joining',attempted_at=?,next_attempt_at=NULL,reason=NULL WHERE project=? AND account=? AND group_username=? AND state='queued' AND generation=?")
          .run(at.toISOString(), project, account, username, generation).changes;
        const row = changed ? get(account, username) : null;
        if (row) audit(row, at);
        return changed > 0;
      })();
    },
  };
}
