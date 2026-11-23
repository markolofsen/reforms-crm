import { Hono } from "hono";
import { projectsDto } from "@hub/contract/responses";
import type { ProjectCatalogServices } from "../composition/capabilities";

export function projectCatalogRoutes({ repos }: ProjectCatalogServices) {
  return new Hono().get("/api/projects", async (c) => c.json(projectsDto.parse({ projects: await repos.projects.list() })));
}
