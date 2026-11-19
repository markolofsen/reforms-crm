import { describe, expect, it } from "vitest";
import { schemeDto, schemeNode, worstFirst, type SchemeNode } from "./scheme";

const part = (id: string, state: SchemeNode["state"], project: string | null = "alpha"): SchemeNode => ({ id, kind: "mail-mcp", project, label: id, state, detail: "", fix: null, place: "agent" });

describe("scheme (P63 O1)", () => {
  it("is strict: a stray field (a client's address, a subject) is a parse failure, and a label is short", () => {
    expect(schemeNode.safeParse({ ...part("a", "ok"), subject: "Re: price" }).success).toBe(false);
    expect(schemeNode.safeParse({ ...part("a", "ok"), label: "x".repeat(81) }).success).toBe(false);
    expect(schemeNode.safeParse({ ...part("a", "ok"), place: "drafts" }).success).toBe(false);
    expect(schemeDto.safeParse({ nodes: [part("a", "ok")], edges: [{ from: "a", to: "a", kind: "flow" }] }).success).toBe(true);
  });

  it("worst first: broken, needs a look, not checked, works; the instance's parts before a project's at one state; else the server's order", () => {
    const nodes = [part("ok1", "ok"), part("unk", "unknown"), part("warn", "warn"), part("fail-p", "fail"), part("fail-i", "fail", null), part("ok2", "ok")];
    expect(worstFirst(nodes).map((n) => n.id)).toEqual(["fail-i", "fail-p", "warn", "unk", "ok1", "ok2"]);
  });
});
