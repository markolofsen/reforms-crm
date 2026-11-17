import { describe, expect, it } from "vitest";
import { classifyMessage, propose, type SenderSample } from "../src/index";

const today = "2026-11-14";
const wl = [{ match: { kind: "from" as const, value: "jane@clientco.example" }, why: "", date: today, by: "owner" as const }];
const s = (from: string, subject: string, extra: Partial<SenderSample> = {}): SenderSample => ({ from, subject, ...extra });

describe("propose", () => {
  const samples: SenderSample[] = [
    s("News <hello@mail.shopexample.example>", "Our newsletter", { hasUnsubscribe: true }),
    s("hello@mail.shopexample.example", "50% off this week", { hasUnsubscribe: true, bulk: true }),
    s("noreply@cibuilds.example", "Build #42 passed"),
    s("noreply@cibuilds.example", "Build #43 failed"),
    s("security@bankone.example", "New sign-in to your account"),
    s("calendar-notification@google.com", "Invitation: Kickoff @ Tue"),
    s("jane@clientco.example", "Re: booking", { hasUnsubscribe: true }),
    s("owner@acme.example", "Note to self"),
    s("quirky@growthpitch.example", "Quick question about your site"),
    s("someone@gmail.com", "Hello there"),
    s("mix@broadmix.example", "50% off sale", { hasUnsubscribe: true }),
    s("mix@broadmix.example", "Can we meet next week?"),
    s("mix@broadmix.example", "Contract draft attached"),
  ];
  const r = propose(samples, { whitelist: wl, ownAddresses: ["owner@acme.example"], today });
  const by = (v: string) => r.proposals.find((p) => p.rule.match.value === v);

  it("classifies by the four heuristics and skips only marketing/service when confident", () => {
    expect(by("mail.shopexample.example")?.rule).toMatchObject({ category: "marketing", action: "label+skip+read", by: "agent" });
    expect(by("cibuilds.example")?.rule).toMatchObject({ category: "service", action: "label+skip+read" });
    expect(by("bankone.example")?.rule).toMatchObject({ category: "security", action: "label" });
    expect(by("google.com")?.rule).toMatchObject({ category: "calendar", action: "label" });
  });
  it("cold outreach is only ever a question, labelled and kept in the inbox", () => {
    const p = by("growthpitch.example");
    expect(p).toMatchObject({ needsConfirmation: true, rule: { category: "cold-outreach", action: "label" } });
  });
  it("leaves uncertain groups unclassified", () => {
    expect(r.unclassified.map((u) => u.group).sort()).toEqual(["broadmix.example", "someone@gmail.com"]);
  });
  it("never proposes client, partner or spam, nor a rule for a whitelisted or own sender", () => {
    expect(r.proposals.every((p) => !["client", "partner", "spam"].includes(p.rule.category))).toBe(true);
    expect(JSON.stringify([r.proposals, r.unclassified])).not.toContain("clientco");
    expect(r.protectedSenders).toEqual([{ from: "jane@clientco.example", count: 1 }]);
    expect(r.ignored).toBe(1);
  });
  it("is stable: same sample, same output, and existing rules are not proposed twice", () => {
    expect(propose(samples, { whitelist: wl, ownAddresses: ["owner@acme.example"], today })).toEqual(r);
    const again = propose(samples, { whitelist: wl, ownAddresses: ["owner@acme.example"], today, existing: { rules: r.proposals.map((p) => p.rule), whitelist: wl, notes: "" } });
    expect(again.proposals).toEqual([]);
    expect(again.covered).toBeGreaterThan(0);
  });
  it("does not let a domain rule swallow a whitelisted address of the same domain", () => {
    const out = propose([s("promo@clientco.example", "Newsletter", { hasUnsubscribe: true })], { whitelist: wl, today });
    expect(out.proposals).toEqual([]);
    expect(out.unclassified[0]?.reason).toMatch(/whitelisted/);
  });
});

describe("classifyMessage", () => {
  const file = { rules: [{ match: { kind: "domain" as const, value: "news.example.org" }, category: "marketing" as const, label: "hub/marketing", action: "label+skip+read" as const, why: "", date: today, by: "agent" as const }], whitelist: [{ match: { kind: "domain" as const, value: "news.example.org" }, why: "", date: today, by: "owner" as const }], notes: "" };
  it("the whitelist beats a rule", () => {
    expect(classifyMessage(file, { from: "A <a@news.example.org>" })?.category).toBe("client");
    expect(classifyMessage({ ...file, whitelist: [] }, { from: "a@news.example.org" })?.category).toBe("marketing");
    expect(classifyMessage(file, { from: "a@other.example" })).toBeNull();
  });
});
