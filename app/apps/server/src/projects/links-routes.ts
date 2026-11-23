import { Hono } from "hono";
import { notFound } from "../http/http";
import { projectLinks } from "./links";
import type { ProjectsContext } from "./context";

/** `GET /api/projects/:slug/links` (P101): declared project links plus safe hrefs for the admin. Read only. */
export function projectLinksRoutes({ repos, root, links: options }: ProjectsContext) {
  return new Hono().get("/api/projects/:slug/links", async (c) => {
    const slug = c.req.param("slug");
    if ((await repos.projects.get(slug)) === null) return notFound(c, "project");
    return c.json(await projectLinks(repos, slug, root, options));
  });
}
