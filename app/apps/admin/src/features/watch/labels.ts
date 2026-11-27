import type { WatchDto, WatchState, WatchView } from "@hub/contract/watch";
import { formatTime, plural } from "@/lib/format";
import { dest, type Dest } from "@/routes/paths";
import type { SearchFor } from "@/routes/table";

export type WatchSearch = SearchFor<"watch.page">;

/** Keep the direction on every view and deep link; changing a filter closes its context. */
export function watchDest(q: WatchSearch, patch: Partial<WatchSearch>): Dest {
  const next = { ...q, ...patch };
  if (patch.direction !== undefined && patch.direction !== q.direction) {
    next.trigger = "";
    next.group = "";
    next.contextGroup = "";
    next.messageId = null;
  }
  if (next.view !== "moments" || patch.trigger !== undefined || patch.group !== undefined) {
    next.contextGroup = "";
    next.messageId = null;
  }
  return dest("watch.page", next);
}

export function directionLabel(direction: NonNullable<WatchDto["directions"]>[number]): string {
  return direction.title + (direction.state === "lens" ? " · lens not loaded" : direction.enabled ? "" : " · off");
}

/** Source publication time, pending analysis and completed analysis are different facts. */
export function freshnessLine(freshness: WatchDto["freshness"]): string | null {
  if (!freshness) return null;
  const message = freshness.lastMessageAt ? `newest source message ${formatTime(freshness.lastMessageAt)}` : "no source messages stored";
  const stored = freshness.lastStoredAt === undefined ? "" : freshness.lastStoredAt ? ` · last stored ${formatTime(freshness.lastStoredAt)}` : " · no ingestion recorded";
  const analysed = freshness.lastAnalysisAt ? `last analysis ${formatTime(freshness.lastAnalysisAt)}` : "no analysis yet";
  return `${message}${stored} · ${plural(freshness.pendingMessages, "message")} awaiting analysis · ${analysed}`;
}

/** P144: the menu's views, in order, in the owner's words. */
export const VIEW_ORDER: readonly WatchView[] = ["triggers", "topics", "moments", "people", "groups", "trend"];
export const VIEW_LABEL: Record<WatchView, string> = { triggers: "Signals", topics: "Topics", moments: "Moments", people: "People", groups: "Groups", trend: "Trend" };

/** The watcher's standing as one word beside its reason. */
export const STATE_WORD: Record<WatchState, string> = { invalid: "Broken list", lens: "Lens not loaded", off: "Off", no_account: "No account", parked: "Paused", polling: "Reading" };

/** A trigger's readable name: the lens's label, else the value itself. */
export const triggerLabel = (d: Pick<WatchDto, "labels">, trigger: string, other = ""): string => (trigger === "other" && other ? `Other: ${other}` : (d.labels[trigger] ?? trigger));

/** Micro-dollars as dollars with cents (a watch month is cents to a few dollars). */
export const microUsd = (n: number): string => `$${(n / 1e6).toFixed(2)}`;

/** The spend line: this month's cost of the lens task against its own budget. */
export const spendLine = (s: WatchDto["spend"]): string => (s.budgetMicroUsd > 0 ? `${microUsd(s.monthMicroUsd)} of ${microUsd(s.budgetMicroUsd)} this month` : `${microUsd(s.monthMicroUsd)} this month`);

type GroupMembership = NonNullable<WatchDto["groups"][number]["membership"]>;
export const MEMBERSHIP_WORD: Record<GroupMembership["state"], string> = {
  unknown: "Unknown", not_member: "Not a member", queued: "Queued", joining: "Joining",
  joined: "Joined", pending: "Approval pending", manual_required: "Manual check required", refused: "Refused",
};
const MEMBERSHIP_NEXT: Record<GroupMembership["state"], string> = {
  unknown: "Membership has not been confirmed.", not_member: "Joining is unavailable.",
  queued: "Waiting for a queue slot.", joining: "Joining is in progress.", joined: "No membership action needed.",
  pending: "Wait for the group's administrator.", manual_required: "Complete the check in Telegram.",
  refused: "No automatic retry.",
};

/** Reading public history never establishes membership or permission to join. */
export function membershipNext(group: WatchDto["groups"][number]): string {
  const state = group.membership?.state ?? "unknown";
  return state === "not_member" && group.canJoin ? "You can join this group." : MEMBERSHIP_NEXT[state];
}

export function membershipTime(membership: GroupMembership | undefined): string | null {
  if (!membership) return null;
  if (membership.nextAttemptAt) return `Next attempt ${formatTime(membership.nextAttemptAt)}`;
  if (membership.state === "joined" && membership.joinedAt) return `Joined ${formatTime(membership.joinedAt)}`;
  if ((membership.state === "queued" || membership.state === "joining") && membership.queuedAt) return `Queued ${formatTime(membership.queuedAt)}`;
  return membership.checkedAt ? `Checked ${formatTime(membership.checkedAt)}` : null;
}

/** Queue progress is the server's account budget, not a count inferred from this direction's rows. */
export function membershipQueueLine(membership: WatchDto["membership"]): string | null {
  if (!membership) return null;
  const mode = membership.enabled ? "Membership queue enabled" : "Membership queue off";
  const next = membership.nextJoinAt ? `next join ${formatTime(membership.nextJoinAt)}` : membership.queued > 0 ? "next join not scheduled" : "no join waiting";
  return `${mode} · ${plural(membership.queued, "group")} queued · ${membership.usedToday} of ${membership.dailyLimit} joins used today · ${next}${membership.reason ? `. ${membership.reason}` : ""}`;
}
