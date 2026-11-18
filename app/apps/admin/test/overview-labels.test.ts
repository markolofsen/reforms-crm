import { describe, expect, it } from "vitest";
import { STATUS_LEVELS, type ProjectRowDto, type StatusDto } from "@hub/contract/overview";
import { LEVEL, needsYou, nextDest, ordered, statusWord, triageText } from "../src/features/overview/labels";
import { formatDest, paths } from "../src/routes/paths";

const status = (over: Partial<StatusDto> = {}): StatusDto => ({ level: "attention", kind: "recipients-test", sentence: "Test mode: sends go to the test list only", next: "project", numbers: { owed: 1, lastTriageAt: null }, ...over });
const row = (slug: string, over: Partial<ProjectRowDto> = {}): ProjectRowDto => ({ slug, name: slug, projectStatus: "active", archived: false, toReview: 0, sentToday: 0, status: status(), ...over });
const NOW = new Date("2026-11-18T12:00:00Z").getTime();
const multi = { project: "alpha", multi: true };

describe("overview labels", () => {
  it("every status level has a word and an icon (the map is total)", () => {
    expect(Object.keys(LEVEL).sort()).toEqual([...STATUS_LEVELS].sort());
  });

  it("Needs you is the worst fact, or a dash when the project is clear", () => {
    expect(needsYou(status())).toBe("Test mode: sends go to the test list only");
    expect(needsYou(status({ level: "clear", kind: "clear", sentence: "All clear", next: null }))).toBe("-");
  });

  it("a row leads into its own project: Drafts by its name, the fix by Needs you; Connections names no project", () => {
    expect(formatDest(paths.drafts.list(), multi)).toBe("/alpha/drafts");
    const project = nextDest(status());
    expect(project && formatDest(project, multi)).toBe("/alpha/project");
    const connections = nextDest(status({ next: "connections" }));
    expect(connections && formatDest(connections, multi)).toBe("/connections");
    expect(nextDest(status({ next: null }))).toBeNull();
    expect(nextDest(status({ level: "clear", next: "project" }))).toBeNull();
  });

  it("last triage is an age, or Never", () => {
    expect(triageText(null, NOW)).toBe("Never");
    expect(triageText("2026-11-18T10:00:00Z", NOW)).toBe("2 h ago");
  });

  it("archived projects go last and say so", () => {
    const rows = [row("a", { archived: true, projectStatus: "active" }), row("b"), row("c")];
    expect(ordered(rows).map((p) => p.slug)).toEqual(["b", "c", "a"]);
    expect(statusWord(row("a", { archived: true }))).toBe("archived");
    expect(statusWord(row("b", { projectStatus: "draft" }))).toBe("draft");
  });
});
