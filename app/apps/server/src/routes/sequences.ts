import { Hono, type Context } from "hono";
import { join } from "node:path";
import type { EnrollmentItem, Repos } from "@hub/db";
import { findSequence, isUsable, loadSequences, pickSequence, scheduleOf, type LoadedSequence } from "@hub/sequences";
import { candidatesDto, enrolBody, enrollmentChangedDto, enrollmentParam, enrollmentsDto, enrollmentsQuery, sequencesDto, slugOnlyParam, stopBody, type EnrollmentDto } from "@hub/contract/sequences";
import { v } from "../http";

/** Follow-ups (P47): the project's sequences, its enrollments, the candidates, and the owner's moves. Nothing here sends or drafts. */
export function sequenceRoutes(repos: Repos, projectsDir: string, now: () => Date) {
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
    // Derived, never stored: our message is newer than theirs and old enough for the shortest wait of a usable sequence.
    .get("/api/projects/:slug/enrollments/candidates", v("param", slugOnlyParam), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return c.json(noProject, 404);
      const usable = defs(slug).filter(isUsable);
      if (usable.length === 0) return c.json(candidatesDto.parse({ candidates: [] }));
      const afterDays = Math.min(...usable.map((d) => d.enrolAfterDays));
      const rows = await repos.enrollments.candidates(slug, { now: now(), afterDays, businessDays: usable.every((d) => d.businessDays) });
      return c.json(candidatesDto.parse({ candidates: rows.map((r) => ({ ...r, sequence: pickSequence(usable, { mailClass: r.last.mailClass, notionKind: r.last.notionKind })?.id ?? null })) }));
    })
    // The owner's Enrol (or Not now). The agent's shell cannot reach loopback (P17 deny rules), so only a person gets here.
    .post("/api/projects/:slug/enrollments", v("param", slugOnlyParam), v("json", enrolBody), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return c.json(noProject, 404);
      const body = c.req.valid("json");
      const all = defs(slug);
      const def = findSequence(all, body.sequence);
      if (!def) return c.json({ error: `No sequence "${body.sequence}" in ${slug}/sequences/`, code: "not_found" as const }, 404);
      if (!isUsable(def)) return c.json({ error: `Sequence "${def.name}" is ${def.status === "Retired" ? "retired" : "not valid: run hub sequences check"}`, code: "wrong_state" as const }, 409);
      const input = { project: slug, clientId: body.clientId, sequence: def.id, sequenceHash: def.hash, schedule: scheduleOf(def), by: "owner", now: now() };
      const row = body.notNow ? await repos.enrollments.notNow(input) : await repos.enrollments.enrol(input);
      const item = await repos.enrollments.get(slug, row.id, now());
      if (!item) return c.json(noProject, 404);
      return c.json(enrollmentChangedDto.parse({ ok: true, enrollment: dto(all)(item) }));
    })
    .post("/api/projects/:slug/enrollments/:id/stop", v("param", enrollmentParam), v("json", stopBody), async (c) => {
      const { slug, id } = c.req.valid("param");
      await repos.enrollments.stop(slug, id, c.req.valid("json").reason, now());
      return changed(c, slug, id);
    })
    .post("/api/projects/:slug/enrollments/:id/pause", v("param", enrollmentParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      await repos.enrollments.pause(slug, id, now());
      return changed(c, slug, id);
    })
    .post("/api/projects/:slug/enrollments/:id/resume", v("param", enrollmentParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      await repos.enrollments.resume(slug, id, now());
      return changed(c, slug, id);
    });

}
