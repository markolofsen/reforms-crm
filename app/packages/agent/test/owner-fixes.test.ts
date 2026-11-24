import { afterEach, describe, expect, it } from "vitest";
import { noteOwnerFix } from "../src/mcp/owner-fixes";
import { toolCtx } from "../src/mcp/ports";
import { REFUSALS } from "../src/mcp/refusals";
import { fakePorts, type FakePorts } from "../src/testing";

// P133 (P129 verdict 11): a refusal only the owner can fix is one row per project and code, until the tool's next success.
let p: FakePorts;
afterEach(() => p.close());

const rows = () => p.write((w) => w.ownerFixes.active(p.slug, p.env.now?.() ?? new Date()));

describe("noteOwnerFix", () => {
  it("records a refusal with a registry fix, once per code, with the registry's line and place", async () => {
    p = fakePorts();
    const ctx = toolCtx(p.repos, p.env);
    await noteOwnerFix(ctx, "draft_write", "mail_not_running");
    await noteOwnerFix(ctx, "draft_write", "mail_not_running");
    expect(await rows()).toMatchObject([{ project: p.slug, code: "mail_not_running", tool: "draft_write", line: REFUSALS.mail_not_running.fix?.line, place: REFUSALS.mail_not_running.fix?.place }]);
  });

  it("ignores a refusal the agent fixes itself and a call with no write connection or project", async () => {
    p = fakePorts();
    await noteOwnerFix(toolCtx(p.repos, p.env), "draft_write", "invalid");
    const noWrite = { ...p.env };
    delete noWrite.withRepos;
    await noteOwnerFix(toolCtx(p.repos, noWrite), "draft_write", "mail_not_allowed");
    await noteOwnerFix(toolCtx(p.repos, { ...p.env, hubProject: undefined }), "draft_write", "mail_not_allowed");
    expect(await rows()).toEqual([]);
  });

  it("the tool's next success clears its rows; another tool's success leaves them", async () => {
    p = fakePorts();
    const ctx = toolCtx(p.repos, p.env);
    await noteOwnerFix(ctx, "draft_write", "mail_not_running");
    await noteOwnerFix(ctx, "client_record", "notion_unavailable");
    await noteOwnerFix(ctx, "message_show", null);
    expect((await rows()).map((r) => r.code).sort()).toEqual(["mail_not_running", "notion_unavailable"]);
    await noteOwnerFix(ctx, "draft_write", null);
    expect((await rows()).map((r) => r.code)).toEqual(["notion_unavailable"]);
  });
});
