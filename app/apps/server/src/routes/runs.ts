import { Hono } from "hono";
import type { Repos } from "@hub/db";
import { idParam, projectQuery } from "@hub/contract/requests";
import { eventsDto, runsDto } from "@hub/contract/responses";
import { projectOverview, projectsRoot } from "../project-overview";
import { projectDoctor } from "../project-doctor";
import { v } from "../http";

/** `root` is where the project folders live (default: HUB_PROJECTS or `<app>/projects`). */
export function runRoutes(repos: Repos, root: string = projectsRoot()) {
  return new Hono()
    .get("/api/runs", v("query", projectQuery), async (c) => c.json(runsDto.parse({ runs: await repos.runs.list(c.req.valid("query").project) })))
    .get("/api/project", v("query", projectQuery), async (c) => c.json(await projectOverview(repos, c.req.valid("query").project, root)))
    .get("/api/project/doctor", v("query", projectQuery), async (c) => c.json(await projectDoctor(repos, c.req.valid("query").project, root)))
    .get("/api/runs/:id/events", v("param", idParam), v("query", projectQuery), async (c) =>
      c.json(eventsDto.parse({ events: await repos.runs.events(c.req.valid("query").project, c.req.valid("param").id) })),
    );
}
