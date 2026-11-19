import { describe, expect, it } from "vitest";
import type { AgentToolRow, AgentToolsDto } from "@hub/contract/agent-tools";
import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { facetsOf, forText, sharedLine } from "../src/features/knowledge/labels";
import { needsAttention, toolsSentence } from "../src/features/settings/agent/labels";

// The UX pass (P70, 2026-11-20): what the Knowledge table leaves out and says once, and the Agent pane's one line.
const entry = (over: Partial<KnowledgeEntryDto> = {}): KnowledgeEntryDto => ({ key: "knowledge:a.md", title: "A", use: "STATE", approved: true, audiences: ["CLIENT", "LEAD"], brands: [], category: "DATA", kind: "RULE", validUntil: null, status: "approved", ...over });

describe("knowledge: a column every entry shares is said once", () => {
  it("all approved and the same audiences: no For or Status column, one line in plain words", () => {
    const f = facetsOf([entry(), entry({ key: "b", audiences: ["LEAD", "CLIENT"] })]);
    expect(f).toEqual({ allApproved: true, sameAudiences: ["CLIENT", "LEAD"], brandsDiffer: false });
    expect(sharedLine(f)).toBe("All approved, for clients and leads.");
  });

  it("an entry not approved or another audience brings its column back; nothing shared says nothing", () => {
    const f = facetsOf([entry(), entry({ key: "b", status: "expired", audiences: ["PARTNER_LEAD"] })]);
    expect(f.allApproved).toBe(false);
    expect(f.sameAudiences).toBeNull();
    expect(sharedLine(f)).toBeNull();
    expect(sharedLine(facetsOf([entry(), entry({ key: "b", status: "unapproved" })]))).toBe("For clients and leads.");
  });

  it("audiences read as words, brands only when they differ", () => {
    expect(forText(entry({ audiences: ["PARTNER_LEAD", "CLIENT"] }), false)).toBe("Partner lead, client");
    expect(forText(entry({ audiences: [] }), false)).toBe("No audience");
    expect(forText(entry({ brands: ["Carapis"] }), true)).toBe("Client, lead · Carapis");
    expect(facetsOf([entry({ brands: ["Carapis"] }), entry({ key: "b", brands: ["Reforms"] })]).brandsDiffer).toBe(true);
  });
});

describe("agent: one line, and only the rows that need him", () => {
  const row = (state: AgentToolRow["state"]): AgentToolRow => ({ id: `x.${state}`, cli: "claude", title: state, state, detail: "", fix: null });
  const dto = (rows: AgentToolRow[]): AgentToolsDto => ({ project: "p", unattended: true, defaultCli: "claude", checkedAt: null, rows, capabilities: [] });
  it("says where the checks stand, without the mode or the default CLI", () => {
    expect(toolsSentence(dto([row("pass")]))).toBe("Ready");
    expect(toolsSentence(dto([row("pass"), row("warn"), row("warn")]))).toBe("Ready, 2 checks to look at");
    expect(toolsSentence(dto([row("fail"), row("warn")]))).toBe("1 check to fix, 1 to look at");
  });
  it("a fix or a look needs him; a pass or a skip does not", () => {
    const states: AgentToolRow["state"][] = ["pass", "warn", "fail", "skip"];
    expect(states.map((s) => needsAttention(row(s)))).toEqual([false, true, true, false]);
  });
});
