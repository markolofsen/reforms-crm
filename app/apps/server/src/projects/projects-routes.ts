import { Hono } from "hono";
import { projectsDto } from "@hub/contract/project";
import type { ProjectsContext } from "./context";

export function projectCatalogRoutes({ repos }: ProjectsContext) {
  return new Hono().get("/api/projects", async (c) => c.json(projectsDto.parse({ projects: await repos.projects.list() })));
}
