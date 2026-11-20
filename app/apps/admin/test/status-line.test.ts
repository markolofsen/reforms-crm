import { describe, expect, it } from "vitest";
import type { StatusDto } from "@hub/contract/overview";
import { lineOf } from "../src/features/mail/status-line";

const NOW = Date.parse("2026-11-18T14:00:00.000Z");
const read = (o: Partial<StatusDto["numbers"]["mailRead"]> = {}): StatusDto["numbers"]["mailRead"] => ({ at: "2026-11-18T13:58:00.000Z", reason: null, reading: false, unknown: 0, ...o });
const ok = { stale: false, serverOlder: false, serverNewer: false };
const status = (o: Partial<StatusDto> = {}): StatusDto => ({ level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 0, wrote: 0, lastTriageAt: "2026-11-16T12:00:00.000Z", mailRead: read() }, ...o });

describe("the Mail status line (P48 W3, P96)", () => {
  it("says the worst fact once, then who wrote, the replies owed beyond them and when Mail was read; never the to-review count or triage", () => {
    expect(lineOf(status(), NOW, ok)).toMatchObject({ level: "clear", sentence: "All clear", numbers: [], wrote: null, read: "Mail read 2 min ago", to: null });
    const l = lineOf(status({ level: "attention", kind: "recipients-test", sentence: "Test mode: sends go to the test list only", next: "sending", numbers: { owed: 3, wrote: 1, lastTriageAt: null, mailRead: read() } }), NOW, ok);
    expect(l.wrote).toBe("1 client wrote");
    // One client once: owed counts the client who wrote too.
    expect(l.numbers).toEqual(["2 replies owed"]);
    expect(l.to?.route).toBe("settings.page");
    expect(JSON.stringify(lineOf(status(), NOW, ok))).not.toMatch(/triage/);
  });
  it("the reader says why it did not read, or that it is reading", () => {
    expect(lineOf(status({ numbers: { owed: 0, wrote: 0, lastTriageAt: null, mailRead: read({ reason: "Mail is not running" }) } }), NOW, ok).read).toBe("Mail is not running");
    expect(lineOf(status({ numbers: { owed: 0, wrote: 0, lastTriageAt: null, mailRead: read({ reading: true }) } }), NOW, ok).read).toBe("Reading Mail…");
    expect(lineOf(status({ numbers: { owed: 0, wrote: 0, lastTriageAt: null, mailRead: read({ at: null }) } }), NOW, ok).read).toBe("Mail not read yet");
  });
  it("Check now comes to the line only when a pass can help and the line has no link of its own (show less, 4a)", () => {
    const at = (o: Parameters<typeof read>[0], next: StatusDto["next"] = null) => lineOf(status({ next, numbers: { owed: 0, wrote: 0, lastTriageAt: null, mailRead: read(o) } }), NOW, ok).check;
    expect(at({})).toBe(false); // read 2 min ago
    expect(at({ at: "2026-11-18T13:30:00.000Z" })).toBe(true); // late
    expect(at({ reason: "Mail is not running" })).toBe(true);
    expect(at({ reason: "Demo mode: Mail is not read" })).toBe(false);
    expect(at({ reason: "Mail is not running" }, "sending")).toBe(false);
  });
  it("leads to the page where the fact is fixed (P70: Overview, Knowledge or a Settings pane)", () => {
    expect(lineOf(status({ level: "attention", next: "connections" }), NOW, ok).to?.route).toBe("settings.connections");
    expect(lineOf(status({ level: "attention", next: "overview" }), NOW, ok).to?.route).toBe("overview.page");
    expect(lineOf(status({ level: "attention", next: "knowledge" }), NOW, ok).to?.route).toBe("knowledge.page");
    expect(lineOf(status({ level: "attention", next: "agent" }), NOW, ok).to?.route).toBe("settings.agent");
  });
  it("what only the page knows outranks the server's sentence: not answering, or a version mismatch", () => {
    expect(lineOf(status(), NOW, { ...ok, stale: true })).toMatchObject({ level: "blocked", sentence: "Server not answering: data may be old" });
    expect(lineOf(status(), NOW, { ...ok, serverOlder: true }).sentence).toMatch(/restart it with hub up/);
    expect(lineOf(status(), NOW, { ...ok, serverNewer: true }).sentence).toMatch(/reload/);
  });
});
