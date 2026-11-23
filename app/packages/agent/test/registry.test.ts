import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DRAFT_TOOLS, SEND_LIKE_TOOL } from "../src/deny";
import { annotationsOf, DESCRIPTION_MAX } from "../src/mcp/define";
import { NEXT_MAX, REFUSAL_CODES, REFUSALS } from "../src/mcp/refusals";
import { HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "../src/mcp/server";
import { ATTENDED_TOOLS, TOOLS } from "../src/mcp/tools";

// P129 A2 (verdicts 1, 2): one tool registry and one refusal registry for `hub mcp`.

const ALL = [...TOOLS, ...ATTENDED_TOOLS];

describe("the tool registry", () => {
  it("is the one list HUB_MCP_TOOLS and HUB_MCP_ATTENDED_TOOLS come from, with unique snake_case names", () => {
    expect([...HUB_MCP_TOOLS]).toEqual(TOOLS.map((t) => t.name));
    expect([...HUB_MCP_ATTENDED_TOOLS]).toEqual(["messenger_send"]);
    const names = ALL.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("keeps every description at most 600 characters and every tool titled", () => {
    for (const t of ALL) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(t.title.trim(), t.name).not.toBe("");
    }
  });

  it("names no tool like a send but decision 0046's one, which is attended only and the one send effect", () => {
    for (const t of TOOLS) if (!DRAFT_TOOLS.includes(t.name)) expect(SEND_LIKE_TOOL.test(t.name), t.name).toBe(false);
    expect(ALL.filter((t) => t.effect === "send").map((t) => t.name)).toEqual(["messenger_send"]);
    expect(TOOLS.some((t) => t.effect === "send")).toBe(false);
  });

  it("has exactly two draft writers (approval-and-capabilities: the draft tools are the only writers of a draft)", () => {
    expect(ALL.filter((t) => t.effect === "draft").map((t) => t.name).sort()).toEqual(["draft_write", "messenger_draft_write"]);
    expect(annotationsOf("read")).toMatchObject({ readOnlyHint: true });
    for (const e of ["pointer", "draft", "send"] as const) expect(annotationsOf(e).readOnlyHint).toBe(false);
  });

  it("gives every tool an object output schema whose JSON Schema an MCP client can read", () => {
    for (const t of ALL) {
      const json = z.toJSONSchema(t.output, { io: "output", unrepresentable: "any" });
      expect(json.type, t.name).toBe("object");
    }
  });

  it("lists only registered refusal codes, each once", () => {
    for (const t of ALL) {
      expect(new Set(t.refusals).size, t.name).toBe(t.refusals.length);
      for (const c of t.refusals) expect(REFUSAL_CODES, `${t.name} ${c}`).toContain(c);
    }
  });
});

describe("the refusal registry", () => {
  it("advises every code: a retry word and a next step of at most 200 characters", () => {
    for (const c of REFUSAL_CODES) {
      const r = REFUSALS[c];
      expect(["now", "after_owner", "no"], c).toContain(r.retry);
      expect(r.next.trim(), c).not.toBe("");
      expect(r.next.length, c).toBeLessThanOrEqual(NEXT_MAX);
    }
  });

  it("gives a fix line only to faults the owner alone can fix", () => {
    const fixable = REFUSAL_CODES.filter((c) => REFUSALS[c].fix);
    expect(fixable.sort()).toEqual(["mail_not_allowed", "mail_not_running", "notion_unavailable", "unavailable"]);
  });

  it("uses each code once", () => {
    expect(new Set(REFUSAL_CODES).size).toBe(REFUSAL_CODES.length);
  });
});
