import { slugParam } from "@hub/contract/requests";
import { watchDto, watchJoinDto, watchJoinParam, watchProjectsDto, watchQuery } from "@hub/contract/watch";
import type { Operation } from "../http/openapi";

/** The watch domain's operations (P144 W6): which projects watch, one project's Watch page, and the owner's Join of one group. */
export const operations: Operation[] = [
  { method: "get", path: "/api/watch", operationId: "listWatchProjects", summary: "List the projects that watch public groups", tags: ["watch"], reply: { name: "WatchProjects", schema: watchProjectsDto }, errors: [] },
  { method: "get", path: "/api/projects/:slug/watch", operationId: "getWatch", summary: "Read one project's Watch page: triggers, topics, moments, people, groups, trend", tags: ["watch"], params: slugParam, query: watchQuery, reply: { name: "Watch", schema: watchDto }, errors: [400, 404, 503] },
  { method: "post", path: "/api/projects/:slug/watch/groups/:username/join", operationId: "joinWatchGroup", summary: "Join one watched group that must be joined to be read (the owner's word)", tags: ["watch"], params: watchJoinParam, reply: { name: "WatchJoin", schema: watchJoinDto }, errors: [403, 404, 409] },
];
