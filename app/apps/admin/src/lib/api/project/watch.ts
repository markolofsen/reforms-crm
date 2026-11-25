import { getWatch, joinWatchGroup, listWatchProjects } from "@hub/api";
import { watchDto, watchJoinDto, watchProjectsDto } from "@hub/contract/watch";
import { readGenerated } from "../client";

/**
 * Watch (P144, decision 0052): what the public groups a project watches talk about, read from the project's watch store.
 * Reads only. The one write is Join: it asks Telegram to add the owner's account to one public group, on his click only
 * (a door: the server takes the admin's own origin, `same-origin`, a loopback host).
 */
export const watchApi = {
  projects: () => readGenerated(listWatchProjects(), watchProjectsDto),
  get: (project: string, q: { days: number; trigger: string | null; group: string | null }) =>
    readGenerated(getWatch(project, { days: q.days, ...(q.trigger ? { trigger: q.trigger } : {}), ...(q.group ? { group: q.group } : {}) }), watchDto),
  join: (project: string, username: string) => readGenerated(joinWatchGroup(project, username), watchJoinDto),
};
