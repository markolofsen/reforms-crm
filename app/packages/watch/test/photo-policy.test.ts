import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { policyGeneration, watchPolicyFile, watchPolicySchema } from "../src/policy";

// Frozen pre-photo canonical serialization. Parsing a legacy grant must not append a false/default field.
const legacyCanonical = '{"account":"123456","approval":{"approvedAt":"2026-11-27T10:00:00.000Z","requestRef":"owner-request"},"directions":{"support":{"groups":["acme_chat"],"join":true,"reply":true,"strategy":{"path":"strategy.md","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}},"enabled":true,"limits":{"joinsPerDay":3,"repliesPerDay":3},"revision":2,"version":1}';

describe("explicit optional photo policy", () => {
  it("preserves the exact old generation when photoReplies is omitted", () => {
    const raw: unknown = JSON.parse(legacyCanonical);
    const parsed = watchPolicySchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(parsed.directions.support).not.toHaveProperty("photoReplies");
    expect(policyGeneration(parsed)).toBe(createHash("sha256").update(legacyCanonical).digest("hex"));
  });

  it("requires reply authority and a new generation for the explicit photo feature", () => {
    const base = watchPolicySchema.parse(JSON.parse(legacyCanonical));
    const support = base.directions.support;
    if (!support) throw new Error("fixture direction missing");
    const enabled = watchPolicySchema.parse({ ...base, directions: { support: { ...support, photoReplies: true } } });
    expect(policyGeneration(enabled)).not.toBe(policyGeneration(base));
    expect(watchPolicySchema.safeParse({ ...base, directions: { support: { ...support, reply: false, photoReplies: true } } }).success).toBe(false);
    expect(watchPolicySchema.safeParse({ ...base, directions: { support: { ...support, photoReplies: "true" } } }).success).toBe(false);
  });

  it("uses the canonical project slug at the protected state-projects seam", () => {
    expect(watchPolicyFile("/hub/state/projects", "acme.support")).toBe("/hub/state/projects/acme.support/watch-policy.json");
    expect(() => watchPolicyFile("/hub/state/projects", "../other")).toThrow(/Invalid project slug/);
  });
});
