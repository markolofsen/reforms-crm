import { join } from "node:path";
import { readWatch } from "@hub/watch/config";
import type { WatchDomain } from "../../watch/start";

/** Resolve the configured source's physical account/peer before SQL. A username alone is not a durable reply identity. */
export function reviewSource(watch: WatchDomain, projectsDir: string, project: string, directionId: string, group: string): { account: string; chatId: number } | { refused: string[] } {
  const config = readWatch(join(projectsDir, project));
  if (config.state !== "ok") return { refused: ["The current Watch configuration is unavailable."] };
  const direction = directionId === "default" ? config.config : config.config.directions?.find((d) => d.id === directionId);
  if (!direction || !direction.groups.includes(group)) return { refused: ["This source does not belong to the selected Watch direction."] };
  const policy = watch.policyFor(project);
  const connected = watch.accountFor(project);
  const configured = config.config.account === "default" ? null : config.config.account;
  if (connected && configured && connected !== configured) return { refused: ["The configured source account changed; wait for its reload."] };
  const account = connected ?? configured ?? (policy.state === "ok" ? policy.policy.account : null);
  const current = watch.project(project);
  const source = current?.state === "ready" ? current.store.group(group) : null;
  const chatId = source?.peerId ? Number(source.peerId) : NaN;
  if (!account || !Number.isSafeInteger(chatId) || chatId >= 0) return { refused: ["The source account and public peer have not been resolved."] };
  return { account, chatId };
}
