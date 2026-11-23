import { Hono } from "hono";
import { activityQuery, projectQuery } from "@hub/contract/requests";
import { activityDto } from "@hub/contract/activity";
import { projectOverview } from "../project-overview";
import { projectDoctor } from "../project-doctor";
import { v } from "../http";
import type { ProjectServices } from "../composition/capabilities";

/** The project files (Settings ▸ Mail, Knowledge, Overview) and Activity. `root` is where the project folders live (default: the instance's `projects/`). Read only. */
export function projectRoutes({ repos, root, policyDir }: ProjectServices) {
  return new Hono()
    .get("/api/project", v("query", projectQuery), async (c) => c.json(await projectOverview(repos, c.req.valid("query").project, root, policyDir)))
    .get("/api/project/doctor", v("query", projectQuery), async (c) => c.json(await projectDoctor(repos, c.req.valid("query").project, root, process.env, policyDir)))
    // What the agent decided: one timeline, newest first, one row per client decision, a page at a time (P73).
    .get("/api/activity", v("query", activityQuery), async (c) => {
      const { project, view, client, before } = c.req.valid("query");
      return c.json(activityDto.parse(await repos.runs.activity(project, { view, client: client ?? null, before: before ?? null })));
    });
}
