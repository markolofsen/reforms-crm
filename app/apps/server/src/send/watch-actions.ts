import { createHash } from "node:crypto";
import { join } from "node:path";
import { readWatch } from "@hub/watch/config";
import { applyPublicReply, proposePublicReply, reconcilePublicReply, publicReplyHashes, type PublicReplyDoorDeps, type PublicReplyPolicy } from "@hub/messengers/door";
import { AdapterError, publicReplyError } from "@hub/messengers";
import type { WatchProposalInput } from "@hub/contract/watch-actions";
import { messengerPolicy } from "./messenger-policy";
import type { SendContext } from "./context";

const refused = (reason: string) => ({ refused: [reason] });
const unavailable = (reason: string): PublicReplyPolicy => ({ refusal: reason, generation: "unavailable", revision: 0, requestRef: "", strategyHash: "", repliesPerDay: 0 });

/** Decision 0061: external review input only. This service neither writes strategy nor generates/schedules a reply. */
export function watchActions(services: SendContext) {
  const { repos, sender, watch, messengers } = services;
  if (!sender || !watch) return null;
  const basePolicy = messengerPolicy(sender);
  const now = sender.now ?? (() => new Date());
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
    const reason = p.lifecycle ?? p.recipients(`telegram:${scope.chatId}`);
    const generation = createHash("sha256").update(JSON.stringify([grant.generation, p.generation, config.config.account, scope.direction, direction.groups])).digest("hex");
    return { refusal: reason, generation, revision: grant.policy.revision, requestRef: grant.policy.approval.requestRef,
      strategyHash: allowed.strategy.sha256, repliesPerDay: grant.policy.limits.repliesPerDay };
  };
  const deps: PublicReplyDoorDeps = {
    repos, policy, now,
    sender: (account) => messengers?.publicSender?.(account),
    async failed(account, error) {
      if (/^FLOOD_/.test(error.code)) watch.queueForAccount(account)?.park(error.retryAfterSeconds ?? 60, "history");
      // A group-specific ban/slow mode never labels the whole owner account banned.
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
      // Keep fresh provider reads, final policy checks, audit and send in ONE queue operation.
      // Nothing waits behind a later join after its audit was already committed.
      return await queue.run("history", action);
    } catch (error) {
      const safe = publicReplyError(error);
      await deps.failed?.(account, safe);
      return refused(queue.parkedUntil() ? `the account is parked until ${queue.parkedUntil()}` : `the account operation did not complete: ${safe.code}; inspect proposal status before any next action`);
    }
  };
  return {
    async context(project: string, direction: string, group: string, messageId: number) {
      const found = locate(project, direction, group);
      if (!found) return refused("this source has not been resolved by the configured connected account");
      return queued(found.scope.account, async () => {
        const current = locate(project, direction, group);
        if (!current || current.target.id !== found.target.id) return refused("the configured peer changed");
        if (current.policy.refusal) return refused(current.policy.refusal);
        const adapter = deps.sender(found.scope.account);
        if (!adapter) return refused("the account is not connected");
        try {
          const snapshot = await adapter.inspect(current.target, messageId);
          return { account: found.scope.account, direction, group, capturedAt: now().toISOString(),
            policyGeneration: current.policy.generation, policyRevision: current.policy.revision, strategyHash: current.policy.strategyHash,
            snapshot, ...publicReplyHashes(snapshot) };
        } catch (error) {
          const safe = publicReplyError(error);
          await deps.failed?.(found.scope.account, safe);
          return refused(`the public source/permissions cannot be read: ${safe.code}`);
        }
      });
    },
    async propose(project: string, input: WatchProposalInput) {
      const found = locate(project, input.direction, input.group);
      if (!found) return refused("this source has not been resolved by the configured connected account");
      return queued(found.scope.account, () => proposePublicReply(deps, { project, direction: input.direction, groupUsername: input.group,
        account: found.scope.account, target: found.target, messageId: input.messageId, text: input.text,
        sourceHash: input.sourceHash, rulesHash: input.rulesHash, reviewRef: input.review.ref, reviewedAt: input.review.at }));
    },
    async get(project: string, id: string) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return null;
      const attempt = await repos.sends.publicAttempt(id);
      // Transport identifiers stay inside the server. The full reviewed text and all proof hashes remain reviewable.
      const { accessHash: _accessHash, randomId: _randomId, targetKey: _targetKey, ...visible } = p;
      return { ...visible, attempt: attempt ? { id: attempt.id, status: attempt.status, messageId: attempt.sentMessageId, reason: attempt.error } : null };
    },
    async send(project: string, id: string, textHash: string) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return refused("the reviewed public proposal does not exist");
      return queued(p.account, () => applyPublicReply(deps, project, id, textHash));
    },
    async reconcile(project: string, id: string, messageId?: number) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return refused("the reviewed public proposal does not exist");
      return queued(p.account, () => reconcilePublicReply(deps, project, id, messageId));
    },
  };
}
