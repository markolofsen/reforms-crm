import { describe, expect, it } from "vitest";
import type { StatusDto } from "@hub/contract/overview";
import { lineOf } from "../src/features/drafts/status-line";

const NOW = Date.parse("2026-11-18T14:00:00.000Z");
const ok = { stale: false, serverOlder: false, serverNewer: false };
const status = (o: Partial<StatusDto> = {}): StatusDto => ({ level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 0, lastTriageAt: "2026-11-16T12:00:00.000Z" }, ...o });

describe("the Drafts status line (P48 W3)", () => {
  it("says the worst fact once, then the triage age and the replies owed; never the to-review count", () => {
    expect(lineOf(status(), NOW, ok)).toMatchObject({ level: "clear", sentence: "All clear", numbers: ["triage 2 d ago"], to: null });
    const l = lineOf(status({ level: "attention", kind: "recipients-test", sentence: "Test mode: sends go to the test list only", next: "project", numbers: { owed: 1, lastTriageAt: null } }), NOW, ok);
    expect(l.numbers).toEqual(["never triaged", "1 reply owed"]);
    expect(l.to?.route).toBe("project.page");
  });
  it("leads to Connections when that is where the fact is fixed", () => {
    expect(lineOf(status({ level: "attention", next: "connections" }), NOW, ok).to?.route).toBe("connections.page");
    // P63: a fact fixed on a child page links there (Setup, Knowledge), and Agent tools' place is Agents.
    expect(lineOf(status({ level: "attention", next: "setup" }), NOW, ok).to?.route).toBe("project.setup");
    expect(lineOf(status({ level: "attention", next: "knowledge" }), NOW, ok).to?.route).toBe("project.knowledge");
    expect(lineOf(status({ level: "attention", next: "agents" }), NOW, ok).to?.route).toBe("agents.page");
  });
  it("what only the page knows outranks the server's sentence: not answering, or a version mismatch", () => {
    expect(lineOf(status(), NOW, { ...ok, stale: true })).toMatchObject({ level: "blocked", sentence: "Server not answering: data may be old" });
    expect(lineOf(status(), NOW, { ...ok, serverOlder: true }).sentence).toMatch(/restart it with hub up/);
    expect(lineOf(status(), NOW, { ...ok, serverNewer: true }).sentence).toMatch(/reload/);
  });
});
