import { createHash } from "node:crypto";
import { join } from "node:path";
import { readWatch } from "@hub/watch/config";
import { publicPhotoAssets, type PublicReplyDoorDeps, type PublicReplyPolicy } from "@hub/messengers/door";
import { AdapterError, publicReplyError } from "@hub/messengers";
import { messengerPolicy } from "../messenger-policy";
import type { SendContext } from "../context";

const refused = (reason: string) => ({ refused: [reason] });
const unavailable = (reason: string): PublicReplyPolicy => ({
  refusal: reason, generation: "unavailable", revision: 0, requestRef: "", strategyHash: "", repliesPerDay: 0,
});

/** CLI and browser controls share policy, the existing connection and one physical-account queue. No new sender is created. */
export function watchActionRuntime(services: SendContext) {
  const { repos, sender, watch, messengers } = services;
  if (!sender || !watch) return null;
  const basePolicy = messengerPolicy(sender);
  const now = sender.now ?? (() => new Date());
  const assets = publicPhotoAssets({ projects: sender.projectsDir });
  const policy: PublicReplyDoorDeps["policy"] = (project, scope) => {
    const config = readWatch(join(sender.projectsDir, project));
    if (config.state !== "ok") return unavailable("the current watch configuration is unavailable");
    const direction = scope.direction === "default" ? config.config : config.config.directions?.find((d) => d.id === scope.direction);
    if (!config.config.on || !direction?.on || !direction.groups.includes(scope.groupUsername)) return unavailable("this source/direction is not enabled in the current watch list");
    if (watch.accountFor(project) !== scope.account || (config.config.account !== "default" && config.config.account !== scope.account)) return unavailable("the granted account is not the connected source account");
    const grant = watch.policyFor(project);
    if (grant.state !== "ok") return unavailable(grant.state === "invalid" ? grant.reason : "no protected owner grant for public actions");
    const allowed = grant.policy.directions[scope.direction];
    if (!grant.policy.enabled || grant.policy.account !== scope.account || !allowed?.reply || !allowed.groups.includes(scope.groupUsername) || !allowed.strategy) return unavailable("the protected owner grant does not permit replies to this source");
    const p = basePolicy(project);
    const reason = p.lifecycle ?? p.recipients("telegram:" + scope.chatId);
    const generation = createHash("sha256").update(JSON.stringify([grant.generation, p.generation, config.config.account, scope.direction, direction.groups])).digest("hex");
    return { refusal: reason, generation, revision: grant.policy.revision, requestRef: grant.policy.approval.requestRef,
      strategyHash: allowed.strategy.sha256, repliesPerDay: grant.policy.limits.repliesPerDay, photoReplies: allowed.photoReplies === true };
  };
  const deps: PublicReplyDoorDeps = {
    repos, policy, now, assets,
    sender: (account) => messengers?.publicSender?.(account),
    async failed(account, error) {
      if (/^FLOOD_/.test(error.code)) watch.queueForAccount(account)?.park(error.retryAfterSeconds ?? 60, "history");
      const loggedOut = /^(AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_DUPLICATED|USER_DEACTIVATED)$/.test(error.code);
      const banned = /^(PHONE_NUMBER_BANNED|USER_DEACTIVATED_BAN)$/.test(error.code);
      if (loggedOut || banned) await messengers?.failed?.("telegram_user", account, new AdapterError(loggedOut ? "logged_out" : "banned", error.code));
    },
  };
  const locate = (project: string, direction: string, group: string) => {
    const p = watch.project(project);
    const account = watch.accountFor(project);
    const g = p?.state === "ready" ? p.store.group(group) : null;
    const id = g?.peerId === null || g?.peerId === undefined ? NaN : Number(g.peerId);
    if (!account || !g || !Number.isSafeInteger(id) || id >= 0) return null;
    const scope = { direction, groupUsername: group, account, chatId: id };
    return { scope, target: { id, accessHash: g.accessHash }, policy: policy(project, scope) };
  };
  const queued = async <T>(account: string, action: () => Promise<T>): Promise<T | { refused: string[] }> => {
    const queue = watch.queueForAccount(account);
    if (!queue) return refused("the source account queue is unavailable");
    try {
      // One operation holds fresh reads, final checks, audit and delivery; no join is interleaved after audit.
      return await queue.run("history", action);
    } catch (error) {
      const safe = publicReplyError(error);
      await deps.failed?.(account, safe);
      return refused(queue.parkedUntil() ? "the account is parked until " + queue.parkedUntil() : "the account operation did not complete: " + safe.code + "; inspect proposal status before any next action");
    }
  };
  const queueReason = (account: string): string | null => {
    const queue = watch.queueForAccount(account);
    if (!queue) return "The source account queue is unavailable.";
    const until = queue.parkedUntil();
    return until ? "The account is parked until " + until + "." : null;
  };
  return { repos, watch, now, assets, deps, locate, queued, queueReason, projectsDir: sender.projectsDir };
}
