import type { Repos } from "@hub/db";

/** Deletes every message past its `retain_until` (90 days after it was stored). Safe to run any time. */
export const purgeNow = (repos: Repos, at: Date = new Date()): Promise<number> => repos.messengers.purgeExpired(at.toISOString());
