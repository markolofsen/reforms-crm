import { describe, expect, it } from "vitest";
import { apiError, parseApiError } from "./errors";
import { sendBody, statusBody } from "./requests";

describe("contract", () => {
  it("never accepts `sent` as a status", () => {
    expect(statusBody.safeParse({ project: "p", status: "sent" }).success).toBe(false);
    expect(statusBody.safeParse({ project: "p", status: "skipped", reason: "wrong person" }).success).toBe(true);
  });
  it("reads a refusal body, an old one with no code, and a foreign one", () => {
    expect(parseApiError({ error: "Nope", code: "wrong_state" }, 409)).toEqual({ error: "Nope", code: "wrong_state" });
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
});
