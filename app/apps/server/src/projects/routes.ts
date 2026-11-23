import { Hono } from "hono";
import type { ProjectsContext } from "./context";
import { projectCatalogRoutes } from "./projects-routes";
import { projectRoutes } from "./project-routes";
import { projectLinksRoutes } from "./links-routes";
import { sequenceRoutes } from "./sequences-routes";
import { knowledgeRoutes } from "./knowledge-routes";

/** Every Projects route over its one context (P126 S1). */
export const routes = (ctx: ProjectsContext) =>
  new Hono().route("/", projectCatalogRoutes(ctx)).route("/", projectRoutes(ctx)).route("/", projectLinksRoutes(ctx)).route("/", sequenceRoutes(ctx)).route("/", knowledgeRoutes(ctx));
