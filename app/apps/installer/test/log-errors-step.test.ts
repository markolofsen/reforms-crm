import { describe, expect, it } from "vitest";
import type { OpsLine } from "@hub/log/ops";
import { logErrorsCheck, WARN_THRESHOLD } from "../src/steps/log";
import { STEPS } from "../src/steps";

// P137 L3: the doctor's `log.errors` row over the ops log's last day.
const at = (level: OpsLine["level"], source: OpsLine["source"], message: string): OpsLine => ({ time: "2026-11-24T10:00:00.000Z", level, source, message });

describe("doctor log.errors (P137 L3)", () => {
  it("passes with no error, saying how many warnings", () => {
    expect(logErrorsCheck([at("warn", "mail", "slow")])).toEqual({ level: "pass", detail: "no errors in 24 h, 1 warning(s)" });
  });

  it("fails on any error line with the most frequent messages first", () => {
    const r = logErrorsCheck([at("error", "mail", "a Mail script failed"), at("error", "mail", "a Mail script failed"), at("error", "notion", "Notion page read failed"), at("warn", "send", "x")]);
    expect(r.level).toBe("fail");
    expect(r.detail).toMatch(/^3 error line\(s\) in 24 h: 2× mail: a Mail script failed; 1× notion: Notion page read failed/);
  });

  it("warns past the threshold of warnings", () => {
    const many = Array.from({ length: WARN_THRESHOLD + 1 }, () => at("warn", "telegram", "poll failed; retrying"));
    expect(logErrorsCheck(many).level).toBe("warn");
  });

  it("is a doctor-only row", () => {
    expect(STEPS.find((s) => s.id === "log.errors")?.audit).toBe(true);
  });
});
