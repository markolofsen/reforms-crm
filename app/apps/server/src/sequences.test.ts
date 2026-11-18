import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";
import { candidatesDto, enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { draftsDto } from "@hub/contract/responses";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { createApp } from "./app";

// P47 routes: the sequences of a project, its enrollments, the candidates, and the owner's moves (409 on a wrong state).

let handle: DbHandle;
let repos: Repos;
let projectsDir: string;
const NOW = new Date("2026-11-30T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const STARTER = join(CORE_ROOT, "app", "projects", "_template", "sequences", "answered-enquiry-no-reply.md");

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  projectsDir = mkdtempSync(join(tmpdir(), "hub-seq-routes-"));
  mkdirSync(join(projectsDir, "p", "sequences"), { recursive: true });
  writeFileSync(join(projectsDir, "p", "sequences", "answered-enquiry-no-reply.md"), readFileSync(STARTER, "utf8"));
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "h" }], addresses: [] });
});
afterEach(() => handle.close());

const app = () => createApp(repos, { overview: { projectsDir }, now: () => NOW });
const call = (path: string, init?: { method: string; body?: unknown }) =>
  app().request(`http://127.0.0.1:4317${path}`, init ? { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body ?? {}) } : undefined);

async function quiet(email: string, outDays = 10) {
  const clientId = await repos.clients.create({ project: "p", email, name: email, repliesOwed: false, lastContactAt: daysAgo(outDays + 2) });
  await repos.drafts.create({ project: "p", clientId, subject: "Re: x", toAddr: email, body: "b", status: "sent", sentAt: daysAgo(outDays), mailClass: "client" });
  return clientId;
}

describe("follow-up routes", () => {
  it("lists the project's sequences; an unknown project is 404", async () => {
    const r = sequencesDto.parse(await (await call("/api/projects/p/sequences")).json());
    expect(r.sequences).toEqual([expect.objectContaining({ id: "answered-enquiry-no-reply", status: "Draft", steps: 3, usable: true, issues: [] })]);
    expect((await call("/api/projects/nope/sequences")).status).toBe(404);
  });

  it("offers a candidate with the sequence that fits, enrols it, then lists it as due", async () => {
    const c = await quiet("a@x.example");
    const cand = candidatesDto.parse(await (await call("/api/projects/p/enrollments/candidates")).json());
    expect(cand.candidates).toEqual([expect.objectContaining({ client: expect.objectContaining({ id: c }), sequence: "answered-enquiry-no-reply" })]);
    const res = await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply" } });
    expect(res.status).toBe(200);
    expect(enrollmentChangedDto.parse(await res.json()).enrollment).toMatchObject({ step: 1, steps: 3, state: "active", sequenceName: "Answered enquiry, no reply", display: "due" });
    const due = enrollmentsDto.parse(await (await call("/api/projects/p/enrollments?view=due")).json());
    expect(due.enrollments.map((e) => e.client.email)).toEqual(["a@x.example"]);
    expect(due.counts).toEqual({ due: 1, active: 1 });
    expect(candidatesDto.parse(await (await call("/api/projects/p/enrollments/candidates")).json()).candidates).toEqual([]);
  });

  it("enrolling twice, or into a sequence that is not there, is refused", async () => {
    const c = await quiet("a@x.example");
    expect((await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply" } })).status).toBe(200);
    const again = await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply" } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "wrong_state" });
    expect((await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "nope" } })).status).toBe(404);
    expect((await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "x", extra: 1 } })).status).toBe(400);
  });

  it("stop finishes it and a second stop is 409; pause and resume; another project's id is 404", async () => {
    const c = await quiet("a@x.example");
    const id = enrollmentChangedDto.parse(await (await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply" } })).json()).enrollment.id;
    expect(enrollmentChangedDto.parse(await (await call(`/api/projects/p/enrollments/${id}/pause`, { method: "POST" })).json()).enrollment.state).toBe("paused");
    expect(enrollmentChangedDto.parse(await (await call(`/api/projects/p/enrollments/${id}/resume`, { method: "POST" })).json()).enrollment.state).toBe("active");
    const stopped = enrollmentChangedDto.parse(await (await call(`/api/projects/p/enrollments/${id}/stop`, { method: "POST", body: {} })).json());
    expect(stopped.enrollment).toMatchObject({ state: "finished", finishReason: "stopped", display: "finished" });
    expect((await call(`/api/projects/p/enrollments/${id}/stop`, { method: "POST", body: {} })).status).toBe(409);
    expect((await call(`/api/projects/other/enrollments/${id}/stop`, { method: "POST", body: {} })).status).toBe(404);
    expect(enrollmentsDto.parse(await (await call("/api/projects/p/enrollments?view=finished")).json()).enrollments).toHaveLength(1);
  });

  it("Not now records a finished row for this silence, so the client is no longer offered", async () => {
    const c = await quiet("a@x.example");
    const r = enrollmentChangedDto.parse(await (await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply", notNow: true } })).json());
    expect(r.enrollment).toMatchObject({ state: "finished", finishReason: "stopped" });
    expect(candidatesDto.parse(await (await call("/api/projects/p/enrollments/candidates")).json()).candidates).toEqual([]);
  });

  it("a step draft carries its step on the Drafts list and the sequences filter shows it", async () => {
    const c = await quiet("a@x.example");
    const id = (await repos.enrollments.enrol({ project: "p", clientId: c, sequence: "answered-enquiry-no-reply", sequenceHash: "h", schedule: { delays: [2, 3, 5], businessDays: true }, by: "owner", now: NOW })).id;
    await repos.drafts.record({ project: "p", email: "a@x.example", name: "a", subject: "Re: x", mailRef: "<step1>", skill: "sequence-drafts", sequence: { enrollmentId: id, step: 1 } });
    const list = draftsDto.parse(await (await call("/api/drafts?project=p&filter=sequences")).json());
    expect(list.drafts.map((d) => d.sequence)).toEqual([{ enrollmentId: id, sequence: "answered-enquiry-no-reply", step: 1, steps: 3, state: "active" }]);
    expect(list.counts.sequences).toBe(1);
  });
});
