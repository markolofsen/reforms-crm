import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { opsErrorsDto } from "@hub/contract/ops-log";
import { OPS_SOURCES, appendOps, type OpsStore } from "@hub/log/ops";
import { OPS_PLACE, opsLogRoutes } from "./routes/ops-log";

// P86: Overview's Recent errors, read from the ops log.
const store = (): OpsStore => ({ dir: mkdtempSync(path.join(tmpdir(), "ops-route-")), secrets: path.join(tmpdir(), "none"), keepDays: 7, softCap: 1e9, hardCap: 2e9 });
const NOW = new Date("2026-11-20T20:00:00Z");

describe("GET /api/ops/errors", () => {
  it("the newest error lines of the last 24 h, newest first, at most 5, each with its place and project", async () => {
    const s = store();
    appendOps(s, { time: "2026-11-19T10:00:00.000Z", level: "error", source: "mail", message: "too old" }, NOW);
    for (let i = 0; i < 6; i++) appendOps(s, { time: `2026-11-20T1${i}:00:00.000Z`, level: "error", source: "notion", message: `notion ${i}` }, NOW);
    appendOps(s, { time: "2026-11-20T18:07:00.000Z", level: "error", source: "whatsapp", message: "account parked", fields: { project: "acme" } }, NOW);
    appendOps(s, { time: "2026-11-20T19:00:00.000Z", level: "warn", source: "send", message: "a warning is not an error" }, NOW);
    const r = await opsLogRoutes(s, () => NOW).request("/api/ops/errors");
    const d = opsErrorsDto.parse(await r.json());
    expect(d.total).toBe(7);
    expect(d.rows.map((x) => x.message)).toEqual(["account parked", "notion 5", "notion 4", "notion 3", "notion 2"]);
    expect(d.rows[0]).toEqual({ time: "2026-11-20T18:07:00.000Z", source: "whatsapp", message: "account parked", place: "messengers", project: "acme" });
    expect(d.rows[1]).toMatchObject({ place: "connections", project: null });
  });

  it("without a store the list is empty, and every source has a place", async () => {
    const d = opsErrorsDto.parse(await (await opsLogRoutes(undefined, () => NOW).request("/api/ops/errors")).json());
    expect(d).toEqual({ rows: [], total: 0, hours: 24 });
    for (const s of OPS_SOURCES) expect(s in OPS_PLACE).toBe(true);
  });
});
