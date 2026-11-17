import { describe, expect, it } from "vitest";
import type { OverviewDto } from "@hub/contract/overview";
import { standingOf, standingText } from "../src/features/shell/status-footer";

const item = (severity: "blocker" | "needs-owner" | "watch") => ({ kind: "drafts-ready", severity, project: "alpha", sentence: "alpha: 2 drafts are ready.", focus: "drafts" });
// @ts-expect-error a partial overview is enough for the line (it reads the verdict, the attention list and the server time)
const dto = (level: string, items: ReturnType<typeof item>[]): OverviewDto => ({ serverTime: "2026-11-18T14:02:00.000Z", verdict: { level, headline: "x" }, attention: items });

describe("the shell status line (P31 O5)", () => {
  it("says it is checking before the first answer and unknown after a failed one, never all clear", () => {
    expect(standingText(standingOf(undefined, false, false))).toBe("Checking status");
    expect(standingText(standingOf(undefined, true, false))).toBe("Status unknown");
  });
  it("all clear, with what is only to watch", () => {
    expect(standingText(standingOf(dto("clear", []), false, false))).toBe("All clear");
    expect(standingText(standingOf(dto("clear", [item("watch"), item("watch")]), false, false))).toBe("All clear, 2 to watch");
  });
  it("counts only what needs the owner, and says blocked", () => {
    expect(standingText(standingOf(dto("attention", [item("needs-owner"), item("watch")]), false, false))).toBe("1 thing needs you");
    expect(standingText(standingOf(dto("blocked", [item("blocker"), item("needs-owner")]), false, false))).toBe("Blocked: 2 things need you");
  });
  it("states when the answer was true if the server is not answering or the last read failed", () => {
    expect(standingText(standingOf(dto("clear", []), false, true))).toMatch(/^All clear, as of \d\d:\d\d$/);
    expect(standingText(standingOf(dto("attention", [item("needs-owner")]), true, false))).toMatch(/^1 thing needs you, as of \d\d:\d\d$/);
  });
});
