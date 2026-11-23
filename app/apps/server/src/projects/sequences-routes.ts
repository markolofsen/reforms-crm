import { Hono, type Context } from "hono";
import { join } from "node:path";
import type { EnrollmentItem } from "@hub/db";
import { findSequence, isUsable, loadSequences, type LoadedSequence } from "@hub/sequences";
import { enrollmentChangedDto, enrollmentParam, enrollmentsDto, enrollmentsQuery, sequencesDto, slugOnlyParam, stopBody, type EnrollmentDto } from "@hub/contract/sequences";
import { v } from "../http/http";
import type { ProjectsContext } from "./context";

/**
 * Follow-ups (P47, P48 D1): the project's sequences and enrollments, read-only, and the owner's Stop. Enrolling is a phrase
 * in a session (`hub sequences enrol --phrase`); pause and resume are the owner's, in his terminal. Nothing here sends or drafts.
 */
export function sequenceRoutes({ repos, root: projectsDir, now }: ProjectsContext) {
  const defs = (slug: string): LoadedSequence[] => loadSequences(join(projectsDir, slug));
  const dto = (all: readonly LoadedSequence[]) => (e: EnrollmentItem): EnrollmentDto => ({ ...e, sequenceName: findSequence(all, e.sequence)?.name ?? e.sequence });
  const known = async (slug: string) => (await repos.projects.list()).includes(slug);
  const noProject = { error: "project not found", code: "not_found" as const };
  // A refusal (no such enrollment: 404, a wrong state: 409) is a RepoError the app's onError maps; here the move succeeded.
  const changed = async (c: Context, slug: string, id: number) => {
    const item = await repos.enrollments.get(slug, id, now());
    return item ? c.json(enrollmentChangedDto.parse({ ok: true, enrollment: dto(defs(slug))(item) })) : c.json({ error: "enrollment not found", code: "not_found" as const }, 404);
  };

  return new Hono()
    .get("/api/projects/:slug/sequences", v("param", slugOnlyParam), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return c.json(noProject, 404);
      return c.json(sequencesDto.parse({ sequences: defs(slug).map((d) => ({ ...d, steps: d.steps.length, usable: isUsable(d) })) }));
    })
    .get("/api/projects/:slug/enrollments", v("param", slugOnlyParam), v("query", enrollmentsQuery), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return c.json(noProject, 404);
      const at = now();
      const [rows, counts] = await Promise.all([repos.enrollments.list(slug, c.req.valid("query").view, at), repos.enrollments.counts(slug, at)]);
      return c.json(enrollmentsDto.parse({ enrollments: rows.map(dto(defs(slug))), counts }));
    })
    .post("/api/projects/:slug/enrollments/:id/stop", v("param", enrollmentParam), v("json", stopBody), async (c) => {
      const { slug, id } = c.req.valid("param");
      await repos.enrollments.stop(slug, id, c.req.valid("json").reason, now());
      return changed(c, slug, id);
    });
}
