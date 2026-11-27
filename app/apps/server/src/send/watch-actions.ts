import { applyPublicReply, assessPublicReply, proposePublicReply, reconcilePublicReply, publicReplyHashes } from "@hub/messengers/door";
import { publicReplyError } from "@hub/messengers";
import type { WatchProposalInput } from "@hub/contract/watch-actions";
import type { SendContext } from "./context";
import { watchActionRuntime } from "./watch-review/runtime";
import { knownReceiptId, publicProposalDto, publicReviewDto } from "./watch-review/projection";
import { reviewSource } from "./watch-review/source";

const refused = (reason: string) => ({ refused: [reason] });

/** External proposals and browser review share one immutable record and the same owner-granted public door. */
export function watchActions(services: SendContext) {
  const runtime = watchActionRuntime(services);
  if (!runtime) return null;
  const { repos, watch, now, assets, deps, locate, queued, queueReason, projectsDir } = runtime;
  const review = async (project: string, id: string, fresh = false) => {
    const p = await repos.sends.publicProposal(project, id);
    if (!p) return null;
    const read = async () => {
      const a = await assessPublicReply(deps, project, id, { fresh });
      return a ? publicReviewDto(a, now().toISOString(), queueReason(p.account)) : null;
    };
    return fresh ? queued(p.account, read) : read();
  };
  return {
    review,
    async list(project: string, input: { direction: string; group: string; messageId: number }) {
      const source = reviewSource(watch, projectsDir, project, input.direction, input.group);
      if ("refused" in source) return source;
      const rows = await repos.sends.publicProposalsForSource({ project, direction: input.direction, groupUsername: input.group,
        account: source.account, chatId: source.chatId, messageId: input.messageId, limit: 20 });
      const items = [];
      for (const row of rows) {
        const a = await assessPublicReply(deps, project, row.id, { fresh: false });
        if (a) items.push(publicReviewDto(a, now().toISOString(), queueReason(row.account)));
      }
      return { project, ...input, observedAt: now().toISOString(), items };
    },
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
          return refused("the public source/permissions cannot be read: " + safe.code);
        }
      });
    },
    async propose(project: string, input: WatchProposalInput) {
      const found = locate(project, input.direction, input.group);
      if (!found) return refused("this source has not been resolved by the configured connected account");
      return queued(found.scope.account, () => proposePublicReply(deps, { project, direction: input.direction, groupUsername: input.group,
        account: found.scope.account, target: found.target, messageId: input.messageId, text: input.text,
        sourceHash: input.sourceHash, rulesHash: input.rulesHash, reviewRef: input.review.ref, reviewedAt: input.review.at,
        ...(input.photo ? { photo: input.photo } : {}) }));
    },
    async get(project: string, id: string) {
      const p = await repos.sends.publicProposal(project, id);
      return p ? publicProposalDto(p, await repos.sends.publicAttempt(id)) : null;
    },
    async photo(project: string, id: string) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p?.photo) return null;
      try {
        return await assets.read(project, p.photo);
      } catch {
        return refused("The reviewed photo is unavailable or its bytes changed.");
      }
    },
    async send(project: string, id: string, payloadHash: string) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return refused("the reviewed public proposal does not exist");
      return queued(p.account, () => applyPublicReply(deps, project, id, payloadHash));
    },
    async reconcile(project: string, id: string, messageId?: number) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return refused("the reviewed public proposal does not exist");
      return queued(p.account, () => reconcilePublicReply(deps, project, id, messageId));
    },
    async reconcileKnown(project: string, id: string) {
      const p = await repos.sends.publicProposal(project, id);
      if (!p) return refused("the reviewed public proposal does not exist");
      const messageId = knownReceiptId(await repos.sends.publicAttempt(p.id));
      if (messageId === null) return refused("No unresolved provider message id is stored. Refresh the status or use the supported CLI with an exact observed id; do not resend.");
      return queued(p.account, () => reconcilePublicReply(deps, project, id, messageId));
    },
  };
}
