import { describe, expect, it } from "vitest";
import { entryStatus, entryTopic, inView, knowledgeEntryDto, knowledgeListDto, OTHER_TOPIC, topicLabel } from "../src/knowledge";

const entry = { key: "knowledge:knowledge/pricing.md", title: "Pricing", use: "STATE", approved: true, audiences: ["client"], brands: [], category: null, kind: null, validUntil: null, status: "approved" } as const;

describe("knowledge list (P70)", () => {
  it("is strict and holds the Open key only: no body, no absolute path", () => {
    expect(knowledgeEntryDto.safeParse(entry).success).toBe(true);
    expect(knowledgeEntryDto.safeParse({ ...entry, body: "secret" }).success).toBe(false);
    expect(knowledgeEntryDto.safeParse({ ...entry, key: "/Users/x/knowledge/pricing.md" }).success).toBe(false);
    expect(knowledgeListDto.safeParse({ scope: "shared", entries: [entry], counts: { all: 1, attention: 0, expired: 0, unapproved: 0 }, truncated: false }).success).toBe(true);
  });

  it("status per date: valid until yesterday is expired, within 14 days expiring, today itself still valid", () => {
    const today = "2026-11-19";
    expect(entryStatus({ approved: true, validUntil: "2026-11-18" }, today)).toBe("expired");
    expect(entryStatus({ approved: false, validUntil: "2026-11-18" }, today)).toBe("expired");
    expect(entryStatus({ approved: true, validUntil: "2026-11-19" }, today)).toBe("expiring");
    expect(entryStatus({ approved: true, validUntil: "2026-12-03T10:00:00Z" }, today)).toBe("expiring");
    expect(entryStatus({ approved: true, validUntil: "2026-12-04" }, today)).toBe("approved");
    expect(entryStatus({ approved: false, validUntil: null }, today)).toBe("unapproved");
    expect(entryStatus({ approved: true, validUntil: null }, today)).toBe("approved");
  });

  it("views: Needs a look holds every status but approved, and an entry no audience can find", () => {
    expect(inView({ status: "approved", audiences: ["client"] }, "attention")).toBe(false);
    expect(inView({ status: "approved", audiences: [] }, "attention")).toBe(true);
    expect(inView({ status: "expiring", audiences: ["client"] }, "attention")).toBe(true);
    expect(inView({ status: "expired", audiences: ["client"] }, "expired")).toBe(true);
    expect(inView({ status: "expiring", audiences: ["client"] }, "expired")).toBe(false);
    expect(inView({ status: "unapproved", audiences: [] }, "all")).toBe(true);
  });
});

describe("entry topic (P74)", () => {
  it("is the folder under files/ or notion/, one label per level; a flat entry falls under its category; neither is Other", () => {
    expect(entryTopic("knowledge:knowledge/files/playbooks/client/a-lead-asks-41306f30.md", "PLAYBOOK")).toEqual(["Playbooks", "Client"]);
    expect(entryTopic("knowledge:knowledge/notion/programmes/grenada/x.md", null)).toEqual(["Programmes", "Grenada"]);
    expect(entryTopic("knowledge:knowledge/files/are-sold-cars-removed-41806f30.md", "DATA")).toEqual(["Data"]);
    expect(entryTopic("knowledge:knowledge/files/x.md", "API")).toEqual(["API"]);
    expect(entryTopic("knowledge:knowledge/pricing.md", null)).toEqual([OTHER_TOPIC]);
    expect(entryTopic("knowledge:knowledge/files/x.md", "  ")).toEqual([OTHER_TOPIC]);
  });

  it("labels: a code or folder as words, capitalised; an upper-case code of three letters or fewer as written", () => {
    expect(topicLabel("ABOUT_DAN")).toBe("About dan");
    expect(topicLabel("four-seasons-nevis")).toBe("Four seasons nevis");
    expect(topicLabel("API")).toBe("API");
    expect(topicLabel("TAX")).toBe("TAX");
    expect(topicLabel("tax")).toBe("Tax");
    expect(topicLabel("PRICING")).toBe("Pricing");
  });
});
