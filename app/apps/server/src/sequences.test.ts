import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_ROOT } from "@hub/config/paths";
import { enrollmentChangedDto, enrollmentsDto, sequencesDto } from "@hub/contract/sequences";
import { draftsDto } from "@hub/contract/review";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { testApp } from "./test-support/runtime";

// P47 routes after P48 D1: the sequences of a project and its enrollments, read-only, and the owner's Stop (409 on a wrong state).
// Enrolling is `hub sequences enrol` in a session; pause and resume are the owner's terminal: none of them is a route.

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

const app = () => testApp(repos, { overview: { projectsDir }, now: () => NOW });
const call = (path: string, init?: { method: string; body?: unknown }) =>
  app().request(`http://127.0.0.1:4317${path}`, init ? { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body ?? {}) } : undefined);

async function quiet(email: string, outDays = 10) {
  const clientId = await repos.clients.create({ project: "p", email, name: email, repliesOwed: false, lastContactAt: daysAgo(outDays + 2) });
  await repos.drafts.create({ project: "p", clientId, subject: "Re: x", toAddr: email, body: "b", status: "sent", sentAt: daysAgo(outDays), mailClass: "client" });
  return clientId;
}
const SCHEDULE = { delays: [2, 3, 5], businessDays: true };
const enrol = async (clientId: number, by = "agent", phrase: string | null = "поставь в follow-up молчащих") =>
  (await repos.enrollments.enrol({ project: "p", clientId, sequence: "answered-enquiry-no-reply", sequenceHash: "h", schedule: SCHEDULE, by, phrase, now: NOW })).id;

describe("follow-up routes", () => {
  it("lists the project's sequences; an unknown project is 404", async () => {
    const r = sequencesDto.parse(await (await call("/api/projects/p/sequences")).json());
    expect(r.sequences).toEqual([expect.objectContaining({ id: "answered-enquiry-no-reply", status: "Draft", steps: 3, usable: true, issues: [] })]);
    expect((await call("/api/projects/nope/sequences")).status).toBe(404);
  });

  it("lists an enrollment as due with who enrolled it and the owner's phrase", async () => {
    await enrol(await quiet("a@x.example"));
    const due = enrollmentsDto.parse(await (await call("/api/projects/p/enrollments?view=due")).json());
    expect(due.enrollments.map((e) => [e.client.email, e.enrolledBy, e.enrolledPhrase, e.sequenceName, e.display])).toEqual([["a@x.example", "agent", "поставь в follow-up молчащих", "Answered enquiry, no reply", "due"]]);
    expect(due.counts).toEqual({ due: 1, active: 1 });
  });

  it("stop finishes it and a second stop is 409; another project's id is 404", async () => {
    const id = await enrol(await quiet("a@x.example"), "owner", null);
    const stopped = enrollmentChangedDto.parse(await (await call(`/api/projects/p/enrollments/${id}/stop`, { method: "POST", body: {} })).json());
    expect(stopped.enrollment).toMatchObject({ state: "finished", finishReason: "stopped", display: "finished", enrolledBy: "owner", enrolledPhrase: null });
    expect((await call(`/api/projects/p/enrollments/${id}/stop`, { method: "POST", body: {} })).status).toBe(409);
    expect((await call(`/api/projects/other/enrollments/${id}/stop`, { method: "POST", body: {} })).status).toBe(404);
    expect(enrollmentsDto.parse(await (await call("/api/projects/p/enrollments?view=finished")).json()).enrollments).toHaveLength(1);
  });

  it("has no enrol, candidates, pause or resume route (decision 0025)", async () => {
    const c = await quiet("a@x.example");
    const id = await enrol(c);
    expect((await call("/api/projects/p/enrollments", { method: "POST", body: { clientId: c, sequence: "answered-enquiry-no-reply" } })).status).toBe(404);
    expect((await call("/api/projects/p/enrollments/candidates")).status).toBe(404);
    expect((await call(`/api/projects/p/enrollments/${id}/pause`, { method: "POST" })).status).toBe(404);
    expect((await call(`/api/projects/p/enrollments/${id}/resume`, { method: "POST" })).status).toBe(404);
    expect((await repos.enrollments.get("p", id))?.state).toBe("active");
  });

  it("a step draft carries its step on the Drafts list and the sequences filter shows it", async () => {
    const c = await quiet("a@x.example");
    const id = await enrol(c, "owner", null);
    await repos.drafts.record({ project: "p", email: "a@x.example", name: "a", subject: "Re: x", mailRef: "<step1>", skill: "sequence-drafts", sequence: { enrollmentId: id, step: 1 } });
    const list = draftsDto.parse(await (await call("/api/drafts?project=p&filter=sequences")).json());
    expect(list.drafts.map((d) => d.sequence)).toEqual([{ enrollmentId: id, sequence: "answered-enquiry-no-reply", step: 1, steps: 3, state: "active" }]);
    expect(list.counts.sequences).toBe(1);
  });
});
