import { describe, expect, it } from "vitest";
import { STATUS_LEVELS, type ProjectRowDto, type StatusDto } from "@hub/contract/overview";
import { SCHEME_STATES } from "@hub/contract/scheme";
import { LEVEL, needsYou, nextDest, ordered, SCHEME_LOOK, statusWord } from "../src/features/overview/labels";
import { mailReadText } from "../src/features/mail/inbox/mail-read";
import { formatDest, dest } from "../src/routes/paths";

const status = (over: Partial<StatusDto> = {}): StatusDto => ({ level: "attention", kind: "recipients-test", sentence: "Test mode: sends go to the test list only", next: "sending", numbers: { owed: 1, wrote: 0, lastTriageAt: null, mailRead: { at: null, reason: null, reading: false, unknown: 0 } }, ...over });
const row = (slug: string, over: Partial<ProjectRowDto> = {}): ProjectRowDto => ({ slug, name: slug, projectStatus: "active", archived: false, toReview: 0, sentToday: 0, status: status(), ...over });
const NOW = new Date("2026-11-18T12:00:00Z").getTime();
const multi = { project: "alpha", multi: true };

describe("overview labels", () => {
  it("every status level has a word and an icon (the map is total)", () => {
    expect(Object.keys(LEVEL).sort()).toEqual([...STATUS_LEVELS].sort());
  });

  it("every part state has a word and an icon, never a colour alone (P63)", () => {
    expect(Object.keys(SCHEME_LOOK).sort()).toEqual([...SCHEME_STATES].sort());
    expect(SCHEME_LOOK.unknown.word).toBe("Not checked here");
  });

  it("Needs you is the worst fact, or a dash when the project is clear", () => {
    expect(needsYou(status())).toBe("Test mode: sends go to the test list only");
    expect(needsYou(status({ level: "clear", kind: "clear", sentence: "All clear", next: null }))).toBe("-");
  });

  it("a row leads into its own project: Mail by its name, the fix by Needs you; an instance pane names no project", () => {
    expect(formatDest(dest("mail.list"), multi)).toBe("/alpha/mail");
    const sending = nextDest(status());
    expect(sending && formatDest(sending, multi)).toBe("/alpha/settings");
    const connections = nextDest(status({ next: "connections" }));
    expect(connections && formatDest(connections, multi)).toBe("/settings/connections");
    const overview = nextDest(status({ next: "overview" }));
    expect(overview && formatDest(overview, multi)).toBe("/overview");
    const agent = nextDest(status({ next: "agent" }));
    expect(agent && formatDest(agent, multi)).toBe("/alpha/settings/agent");
    expect(nextDest(status({ next: null }))).toBeNull();
    expect(nextDest(status({ level: "clear", next: "sending" }))).toBeNull();
  });

  it("the Mail reader's line is an age, or why Mail is not read (P96: it replaced Last triage)", () => {
    expect(mailReadText({ at: null, reason: "Mail is not running", reading: false, unknown: 0 }, NOW)).toBe("Mail is not running");
    expect(mailReadText({ at: "2026-11-18T10:00:00Z", reason: null, reading: false, unknown: 0 }, NOW)).toBe("Mail read 2 h ago");
    expect(mailReadText({ at: null, reason: null, reading: true, unknown: 0 }, NOW)).toBe("Reading Mail…");
  });

  it("archived projects go last and say so", () => {
    const rows = [row("a", { archived: true, projectStatus: "active" }), row("b"), row("c")];
    expect(ordered(rows).map((p) => p.slug)).toEqual(["b", "c", "a"]);
    expect(statusWord(row("a", { archived: true }))).toBe("archived");
    expect(statusWord(row("b", { projectStatus: "draft" }))).toBe("draft");
  });
});
