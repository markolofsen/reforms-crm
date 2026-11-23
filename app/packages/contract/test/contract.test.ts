import { describe, expect, it } from "vitest";
import { coreUpdateDto } from "../src/instance";
import { apiError, parseApiError } from "../src/errors";
import { sendBody, statusBody } from "../src/requests";
import { reviewDraftDto } from "../src/review";
import { enrollmentDto, enrollmentsQuery, stopBody } from "../src/sequences";
import { notionIdentityDto } from "../src/notion";

describe("contract", () => {
  it("never accepts `sent` as a status", () => {
    expect(statusBody.safeParse({ project: "p", status: "sent" }).success).toBe(false);
    expect(statusBody.safeParse({ project: "p", status: "skipped", reason: "wrong person" }).success).toBe(true);
  });
  it("reads a refusal body, an old one with no code, and a foreign one", () => {
    expect(parseApiError({ error: "Nope", code: "wrong_state" }, 409)).toEqual({ error: "Nope", code: "wrong_state" });
    expect(parseApiError({ error: "Unavailable", code: "unavailable" }, 503)).toEqual({ error: "Unavailable", code: "unavailable" });
    expect(parseApiError({ error: "Nope" }, 404)).toEqual({ error: "Nope", code: "not_found" });
    expect(parseApiError("<html>bad gateway</html>", 502)).toEqual({ error: "Request failed (502)", code: "server" });
    expect(apiError.safeParse({ error: "x", code: "weird" }).success).toBe(false);
  });
  it("a send must carry what the person confirmed; a dry run needs nothing", () => {
    expect(sendBody.safeParse({ apply: false }).success).toBe(true);
    expect(sendBody.safeParse({ apply: true }).success).toBe(false);
    expect(sendBody.safeParse({ apply: true, confirm: { to: [], subject: "s" } }).success).toBe(false);
    expect(sendBody.safeParse({ apply: true, confirm: { to: ["a@b.c"], subject: "s" } }).success).toBe(true);
  });
  it("keeps the list of reasons in a refusal", () => {
    expect(parseApiError({ error: "Not sent", code: "wrong_state", refused: ["a", "b"] }, 409)).toEqual({ error: "Not sent", code: "wrong_state", refused: ["a", "b"] });
  });
  it("follow-ups (P47, D1 of P48): an enrolment carries the owner's phrase (or null); stop never takes the engine's own `completed`", () => {
    expect(enrollmentDto.shape.enrolledPhrase.safeParse(null).success).toBe(true);
    expect(enrollmentDto.shape.enrolledPhrase.safeParse("подготовь follow-up молчащим").success).toBe(true);
    expect(enrollmentDto.shape.enrolledPhrase.safeParse(undefined).success).toBe(false);
    expect(stopBody.parse({})).toEqual({ reason: "stopped" });
    expect(stopBody.safeParse({ reason: "completed" }).success).toBe(false);
    expect(enrollmentsQuery.parse({})).toEqual({ view: "due" });
    expect(enrollmentsQuery.safeParse({ view: "everything" }).success).toBe(false);
    expect(reviewDraftDto.shape.sequence.safeParse(null).success).toBe(true);
    expect(reviewDraftDto.shape.sequence.safeParse({ enrollmentId: 1, sequence: "s", step: 2, steps: 4, state: "active" }).success).toBe(true);
  });
  it("keeps the shared Notion identity states distinct for Mail and Messenger", () => {
    expect(notionIdentityDto.parse({ state: "resolved", pageId: "page", url: null })).toEqual({ state: "resolved", pageId: "page", url: null });
    expect(notionIdentityDto.safeParse({ state: "unresolved", pageId: null, url: null }).success).toBe(true);
    expect(notionIdentityDto.safeParse({ state: "connected", pageId: "page", url: null }).success).toBe(false);
    expect(notionIdentityDto.safeParse({ state: "resolved", pageId: null, url: null, label: "extra" }).success).toBe(false);
  });
});

describe("the core update notice (P68)", () => {
  const fixture = {
    pin: "v0.12.11",
    inUse: "v0.12.11",
    newest: "v0.12.12",
    level: "available",
    reason: "1 newer release (patch); dependencies change",
    tags: [{ name: "v0.12.12", date: "2026-11-03T10:00:00+00:00", subject: "core: v0.12.12 (P64 resume)" }],
    facts: { dependencies: true, migrations: false, rollback: false },
    command: ["cd /x/saas && ./run.sh core update v0.12.12 --apply", 'git add core core.version && git commit -m "core: v0.12.12"', "./run.sh restart"],
    checkedAt: "2026-11-19T12:00:00.000Z",
  };
  it("parses the answer strictly: an unknown field, a level outside the list or a stray tag name fails", () => {
    expect(coreUpdateDto.parse(fixture)).toEqual(fixture);
    expect(coreUpdateDto.safeParse({ ...fixture, path: "/x" }).success).toBe(false);
    expect(coreUpdateDto.safeParse({ ...fixture, level: "urgent" }).success).toBe(false);
    expect(coreUpdateDto.safeParse({ ...fixture, tags: [{ name: "backup-1", date: null, subject: "" }] }).success).toBe(false);
    expect(coreUpdateDto.safeParse({ ...fixture, error: { at: "2026-11-19T15:00:00.000Z", message: "origin unreachable: offline" } }).success).toBe(true);
  });
});
