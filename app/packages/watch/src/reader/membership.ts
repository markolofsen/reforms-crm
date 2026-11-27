import { watchDirections, watchGroups, type WatchConfig } from "../config";
import type { WatchPolicyRead } from "../policy";
import type { WatchStore, WatchMembership } from "../store/repo";
import { FloodWaitError, PeerUnknownError, type PublicPeer, type PublicReader } from "./types";
import { WatchBudgetSpent, WatchParked, type WatchQueue } from "./queue";
import type { Watcher, WatcherDeps } from "./poller";

const HOUR = 3_600_000;
const verifiedGroup = (peer: PublicPeer | null, username: string): peer is PublicPeer => !!peer && peer.kind === "group" && peer.canonicalUsername === username && peer.isMember !== undefined;
interface Dependencies {
  store: WatchStore; queue: WatchQueue; reader: () => PublicReader | null; config: () => WatchConfig;
  policy: () => WatchPolicyRead; account: () => string | null; now: () => Date; onWritten?: () => void;
}

/** A readable public source can still be a non-member. Keep those facts in different columns. */
export function observeMembership(store: WatchStore, account: string, username: string, peer: PublicPeer, at: Date): void {
  if (peer.isMember === undefined || peer.canonicalUsername !== username) return;
  const old = store.membership(account, username);
  const state = peer.isMember ? "joined" : old?.state === "joined" || !old ? "not_member" : old.state;
  store.setMembership(account, username, { peerId: peer.peerId, kind: peer.kind ?? null, state, checkedAt: at.toISOString(),
    ...(peer.isMember ? { joinedAt: old?.joinedAt ?? at.toISOString(), nextAttemptAt: null, reason: null } : {}) }, at);
  if (!peer.isMember && store.group(username)?.access === "joined") store.setGroup(username, { access: "open" });
}

const afterJoined = (store: WatchStore, username: string) => {
  const previous = store.group(username);
  // Joining proves membership only. A history that was blocked needs its first successful read.
  if (previous && !["open", "joined"].includes(previous.access)) store.setGroup(username, { access: "unknown", lastPolledAt: null });
};

function allowed(d: Dependencies, account: string): { usernames: Set<string>; generation: string; requestRef: string } | null {
  const read = d.policy();
  if (read.state !== "ok" || !read.policy.enabled || read.policy.account !== account || !d.config().on) return null;
  const usernames = new Set(watchDirections(d.config()).filter((c) => c.on).flatMap((c) => {
    const grant = read.policy.directions[c.id];
    return grant?.join ? c.groups.filter((u) => grant.groups.includes(u)) : [];
  }));
  return { usernames, generation: read.generation, requestRef: read.policy.approval.requestRef };
}

const sourcePeer = (store: WatchStore, username: string): PublicPeer | null => {
  const g = store.group(username);
  return g?.peerId ? { peerId: g.peerId, accessHash: g.accessHash, title: g.title } : null;
};

async function inspect(d: Dependencies, account: string, username: string): Promise<PublicPeer | null> {
  const reader = d.reader();
  const peer = sourcePeer(d.store, username);
  if (!reader?.inspect || !peer) return null;
  const lookup = reader.inspect.bind(reader);
  const fresh = await d.queue.run("history", () => lookup(peer));
  if (fresh && fresh.peerId === peer.peerId && verifiedGroup(fresh, username)) {
    observeMembership(d.store, account, username, fresh, d.now());
    d.store.setGroup(username, { peerId: fresh.peerId, accessHash: fresh.accessHash ?? null });
    return fresh;
  }
  return null;
}

function enqueue(d: Dependencies, account: string): void {
  const grant = allowed(d, account);
  if (!grant) return;
  for (const username of grant.usernames) {
    const old = d.store.membership(account, username);
    if (!sourcePeer(d.store, username) || old?.kind === "channel") continue;
    if (old && !["unknown", "not_member", "queued"].includes(old.state)) continue;
    if (old?.state === "queued" && old.generation === grant.generation) continue;
    d.store.setMembership(account, username, { state: "queued", queuedAt: old?.queuedAt ?? d.now().toISOString(), nextAttemptAt: null,
      generation: grant.generation, requestRef: grant.requestRef, reason: null }, d.now());
    d.onWritten?.();
  }
}

async function reconcile(d: Dependencies, account: string, row: WatchMembership): Promise<void> {
  try {
    const peer = await inspect(d, account, row.username);
    if (peer?.isMember) {
      afterJoined(d.store, row.username);
    } else {
      const pending = row.state === "pending" && peer !== null;
      d.store.setMembership(account, row.username, { state: pending ? "pending" : "manual_required", checkedAt: d.now().toISOString(),
        nextAttemptAt: pending ? new Date(d.now().getTime() + HOUR).toISOString() : null,
        reason: pending ? "Waiting for the group's administrator." : "The previous join outcome is unknown; inspect it before another attempt." }, d.now());
    }
  } catch {
    d.store.setMembership(account, row.username, { nextAttemptAt: d.queue.joinStatus().nextAt ?? new Date(d.now().getTime() + HOUR).toISOString(), reason: "Membership could not be checked; no join was retried." }, d.now());
  }
  d.onWritten?.();
}

async function joinQueued(d: Dependencies, account: string, row: WatchMembership): Promise<void> {
  try {
    const peer = await inspect(d, account, row.username);
    if (peer?.isMember) { afterJoined(d.store, row.username); d.onWritten?.(); return; }
    if (!verifiedGroup(peer, row.username)) {
      d.store.setMembership(account, row.username, { state: "manual_required", reason: "A current public group identity could not be verified.", nextAttemptAt: null }, d.now());
      d.onWritten?.();
      return;
    }
    const reader = d.reader();
    if (!reader) return;
    const result = await d.queue.run("join", async () => {
      const grant = allowed(d, account);
      if (d.account() !== account || !grant?.usernames.has(row.username) || grant.generation !== row.generation) throw new Error("The join grant changed before the call");
      if (!d.store.claimMembership(account, row.username, grant.generation, d.now())) throw new Error("The queued join was already claimed");
      return reader.join(peer);
    });
    const at = d.now();
    d.store.setMembership(account, row.username, { state: result, checkedAt: at.toISOString(),
      ...(result === "joined" ? { joinedAt: at.toISOString() } : {}), nextAttemptAt: result === "pending" ? new Date(at.getTime() + HOUR).toISOString() : null,
      reason: result === "manual_required" ? "The group requires a manual guard-bot or webview step; no bot was contacted." : result === "pending" ? "Waiting for the group's administrator." : null }, at);
    if (result === "joined") afterJoined(d.store, row.username);
  } catch (e) {
    const current = d.store.membership(account, row.username);
    const waiting = e instanceof FloodWaitError || current?.state === "queued";
    d.store.setMembership(account, row.username, { state: waiting ? "queued" : "manual_required", nextAttemptAt: waiting ? d.queue.joinStatus().nextAt ?? new Date(d.now().getTime() + HOUR).toISOString() : null,
      reason: waiting ? "The account is waiting before another join attempt." : "The join did not return a known result; verify membership before retrying." }, d.now());
  }
  d.onWritten?.();
}

/** One bounded membership action per existing poll tick; no extra timer, client or model process. */
export async function membershipTick(d: Dependencies): Promise<void> {
  const account = d.account();
  if (!account || !d.config().on || !d.reader() || d.queue.parkedUntil()) return;
  for (const g of d.store.groups()) {
    if (g.access === "pending" && watchGroups(d.config()).includes(g.username) && !d.store.membership(account, g.username)) {
      d.store.setMembership(account, g.username, { state: "pending", peerId: g.peerId, nextAttemptAt: d.now().toISOString(), reason: "A join request predates membership tracking." }, d.now());
    }
  }
  enqueue(d, account);
  const active = new Set(watchDirections(d.config()).filter((c) => c.on).flatMap((c) => c.groups));
  const rows = d.store.memberships(account).filter((r) => active.has(r.username));
  const due = (r: WatchMembership) => !r.nextAttemptAt || Date.parse(r.nextAttemptAt) <= d.now().getTime();
  const pending = rows.find((r) => ["pending", "joining"].includes(r.state) && due(r));
  if (pending) { await reconcile(d, account, pending); return; }
  const grant = allowed(d, account);
  const status = d.queue.joinStatus();
  if (!grant || status.reason || status.nextAt) return;
  const row = rows.find((r) => r.state === "queued" && grant.usernames.has(r.username) && r.generation === grant.generation && due(r));
  if (row) await joinQueued(d, account, row);
}

/** The existing owner's button uses the same queue and membership evidence, without granting background sends. */
export async function ownerJoin(d: WatcherDeps, now: () => Date, resolvePeer: (reader: PublicReader, username: string, expectedPeerId?: string) => Promise<PublicPeer | null>, username: string): ReturnType<Watcher["join"]> {
  const reader = d.reader();
  const g = d.store.group(username);
  if (!g || !watchGroups(d.config).includes(username)) return { ok: false, reason: "This group is not on the watch list." };
  if (!reader) return { ok: false, reason: "No Telegram account is connected for this watch list." };
  const account = d.membership?.account();
  if (account && d.store.membership(account, username)?.state === "joined") { afterJoined(d.store, username); return { ok: true, access: "joined" }; }
  const previous = account ? d.store.membership(account, username) : null;
  if ((previous && ["queued", "joining", "pending", "manual_required", "refused"].includes(previous.state)) || ["pending", "refused"].includes(g.access)) return { ok: false, reason: "This membership already waits or needs manual review; no join was repeated." };
  if (account && !reader.inspect) return { ok: false, reason: "Membership inspection is unavailable; no join was attempted." };
  let peer = sourcePeer(d.store, username);
  if (!peer) return { ok: false, reason: "The group has not been resolved yet; it is read on the next poll." };
  try {
    if (account && reader.inspect) {
      const lookup = reader.inspect.bind(reader);
      const target = peer;
      const fresh = await d.queue.run("history", () => lookup(target));
      if (!verifiedGroup(fresh, username) || fresh.peerId !== target.peerId) return { ok: false, reason: "The public group identity could not be verified." };
      observeMembership(d.store, account, username, fresh, now());
      if (fresh.isMember) { afterJoined(d.store, username); d.onWritten?.(); return { ok: true, access: "joined" }; }
      peer = fresh;
    }
    const pinnedPeerId = peer.peerId;
    let ownAttemptAt: string | null = null;
    const ask = (p: PublicPeer) => d.queue.run("join", () => {
      if (!watchGroups(d.config).includes(username) || d.store.group(username)?.peerId !== pinnedPeerId || (account && d.membership?.account() !== account)) throw new Error("The selected source or account changed");
      const current = account ? d.store.membership(account, username) : null;
      if (current?.state === "joined") return Promise.resolve("joined" as const);
      if (current && (["queued", "pending", "manual_required", "refused"].includes(current.state) || (current.state === "joining" && current.attemptedAt !== ownAttemptAt))) throw new Error("Membership changed while this action waited");
      ownAttemptAt = now().toISOString();
      if (account) d.store.setMembership(account, username, { state: "joining", attemptedAt: ownAttemptAt, requestRef: "owner_ui", generation: null }, now());
      return reader.join(p);
    });
    let access;
    try {
      access = await ask(peer);
    } catch (e) {
      if (!(e instanceof PeerUnknownError)) throw e;
      const again = await resolvePeer(reader, username, pinnedPeerId);
      if (!again || again.peerId !== pinnedPeerId || (account && !verifiedGroup(again, username))) return { ok: false, reason: "The public group identity changed or could not be refreshed." };
      access = await ask(again);
    }
    if (access === "joined") afterJoined(d.store, username);
    else if (access === "pending" && g.access !== "open") d.store.setGroup(username, { access: "pending", parkReason: null, lastPolledAt: null });
    if (account) d.store.setMembership(account, username, { state: access, checkedAt: now().toISOString(),
      ...(access === "joined" ? { joinedAt: now().toISOString() } : {}), nextAttemptAt: access === "pending" ? new Date(now().getTime() + 3_600_000).toISOString() : null,
      reason: access === "manual_required" ? "This group requires a manual join step." : null, requestRef: "owner_ui", generation: null }, now());
    d.onWritten?.();
    return { ok: true, access };
  } catch (e) {
    if (account && d.store.membership(account, username)?.state === "joining") d.store.setMembership(account, username,
      { state: e instanceof FloodWaitError ? "not_member" : "manual_required", nextAttemptAt: d.queue.parkedUntil(), reason: "The join did not complete; membership must be checked before retrying." }, now());
    d.onWritten?.();
    return { ok: false, reason: e instanceof WatchBudgetSpent || e instanceof WatchParked || e instanceof FloodWaitError ? e.message : "Telegram did not accept the join." };
  }
}
