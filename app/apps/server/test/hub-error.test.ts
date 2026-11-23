import { describe, expect, it } from "vitest";
import { HubError, STATUS_OF } from "@hub/config/errors";
import { RepoError } from "@hub/db";
import { AdapterError, MessengersError } from "@hub/messengers";
import { NotTestable, Refusal } from "../src/instance/connections";
import { MessengerReplyError } from "../src/messengers/reply";
import { AutostartNotSetUp } from "../src/instance/autostart";

// P126 E1: the before/after table of the server's answers. Exactly two rows changed: a repository's `invalid` (409 → 400)
// and `unknown_project` (409 → 404); every other refusal keeps the status its route gave it by hand.
const status = (e: HubError) => STATUS_OF[e.kind];

describe("a HubError's status", () => {
  it("is the route's old answer for every class whose catch went", () => {
    expect(status(new RepoError("not_found", "x"))).toBe(404);
    for (const code of ["empty_query", "duplicate_claim", "duplicate_identifier", "wrong_state"] as const) expect(status(new RepoError(code, "x")), code).toBe(409);
    expect(status(new MessengersError("chat_not_allowed", "x"))).toBe(409);
    expect(status(new AdapterError("network", "x"))).toBe(502);
    expect(status(new NotTestable("Notion"))).toBe(409);
    expect(status(new Refusal("x", 400))).toBe(400);
    expect(status(new Refusal("x", 409))).toBe(409);
    expect(status(new MessengerReplyError("not_found", "x"))).toBe(404);
    expect(status(new MessengerReplyError("unavailable", "x"))).toBe(503);
    expect(status(new MessengerReplyError("refused", "x"))).toBe(409);
    expect(status(new AutostartNotSetUp("x"))).toBe(409);
  });

  it("changes exactly two repository rows", () => {
    expect(status(new RepoError("invalid", "invalid: x"))).toBe(400);
    expect(status(new RepoError("unknown_project", "unknown_project: x"))).toBe(404);
  });

  it("keeps each class's own code and name", () => {
    const e = new RepoError("unknown_project", "m");
    expect(e).toBeInstanceOf(HubError);
    expect([e.code, e.kind, e.name, e.message]).toEqual(["unknown_project", "not_found", "RepoError", "m"]);
  });
});
