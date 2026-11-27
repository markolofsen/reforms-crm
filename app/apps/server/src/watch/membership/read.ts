import type { WatchDomain, WatchProject } from "../start";
import type { WatchDto } from "@hub/contract/watch";

/** Membership status is still visible when a direction is paused; readability stays on the source's access field. */
export function membershipView(domain: WatchDomain | undefined, p: Extract<WatchProject, { state: "ready" }>, direction: string, groups: string[], on: boolean) {
  const policy = domain?.policyFor(p.slug) ?? { state: "none" as const };
  const connected = domain?.accountFor(p.slug) ?? null;
  const account = connected ?? (policy.state === "ok" ? policy.policy.account : null);
  const rows = account ? p.store.memberships(account).filter((r) => groups.includes(r.username)) : [];
  const queue = connected ? domain?.queueForAccount(connected) : null;
  const quota = account ? domain?.joinStatusFor(account) : queue?.joinStatus();
  const grant = policy.state === "ok" ? policy.policy.directions[direction] : undefined;
  const reason = policy.state === "invalid" ? policy.reason : policy.state === "none" ? "No owner grant for public group membership." : !policy.policy.enabled
    ? "Public actions are off." : !on ? "This direction is off; queued joins are retained." : policy.policy.account !== connected
      ? "The granted Telegram account is not connected for this project." : !grant?.join ? "Joining is not granted for this direction." : quota?.reason ?? null;
  const summary: NonNullable<WatchDto["membership"]> = { enabled: reason === null, reason, dailyLimit: quota?.limit ?? (policy.state === "ok" ? policy.policy.limits.joinsPerDay : 3),
    usedToday: quota?.used ?? 0, queued: rows.filter((r) => r.state === "queued" || r.state === "joining").length, nextJoinAt: quota?.nextAt ?? null };
  return { summary,
    group(username: string, access: string) {
      const row = rows.find((r) => r.username === username);
      return { membership: { state: row?.state ?? "unknown", checkedAt: row?.checkedAt ?? null, joinedAt: row?.joinedAt ?? null, queuedAt: row?.queuedAt ?? null,
        nextAttemptAt: row?.nextAttemptAt ?? (row?.state === "queued" ? quota?.nextAt ?? null : null), reason: row?.reason ?? null },
      canJoin: !!connected && !!quota && quota.reason === null && quota.nextAt === null && ["open", "join_required"].includes(access)
        && ((row?.state === "not_member" && row.kind === "group") || (!row && access === "join_required")) };
    },
  };
}
