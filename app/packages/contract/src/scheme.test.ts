import { describe, expect, it } from "vitest";
import { buildScheme, SCHEME_STATES, SCHEME_WORDS, schemeDto, schemeNode, schemeText, worstFirst, type SchemeDto, type SchemeNode } from "./scheme";

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

const at = (id: string, kind: SchemeNode["kind"], project: string | null, label: string, state: SchemeNode["state"]): SchemeNode => ({ id, kind, project, label, state, detail: "", fix: null, place: null });

describe("buildScheme (P63 O2, decision 0035)", () => {
  it("one project: the exact text (instance parts first, one subgraph, the client mail start, edges, a class line per state)", () => {
    const dto: SchemeDto = {
      nodes: [at("cli:claude", "cli", null, "Claude Code 2.1.220", "ok"), at("a:box", "mailbox", "alpha", "hello@example.com", "ok"), at("a:mcp", "mail-mcp", "alpha", "mail-mcp", "fail"), at("a:guard", "guard", "alpha", "Guard", "unknown")],
      edges: [{ from: "a:box", to: "a:mcp", kind: "flow" }, { from: "a:mcp", to: "cli:claude", kind: "flow" }, { from: "a:guard", to: "cli:claude", kind: "limits" }, { from: "a:mcp", to: "gone", kind: "flow" }],
    };
    expect(buildScheme(dto)).toBe(
      [
        "flowchart LR",
        '  mail(["Client mail"])',
        '  n1["Claude Code 2.1.220<br/>Works"]',
        '  subgraph p1["alpha"]',
        '    n2["hello@example.com<br/>Works"]',
        '    n3["mail-mcp<br/>Broken"]',
        '    n4["Guard<br/>Not checked here"]',
        "  end",
        "  mail --> n2",
        "  n2 --> n3",
        "  n3 --> n1",
        "  n4 -.-> n1",
        "  class n1,n2 ok",
        "  class n3 fail",
        "  class n4 unknown",
        "  class mail outside",
      ].join("\n"),
    );
  });

  it("two projects: two subgraphs, ids by position whatever the names", () => {
    const text = buildScheme({ nodes: [at("x:1", "setup", "beta", "Project setup", "warn"), at("y:1", "setup", "gamma", "Project setup", "ok")], edges: [] });
    expect(text).toContain('subgraph p1["beta"]');
    expect(text).toContain('subgraph p2["gamma"]');
    expect(text).toContain('n1["Project setup<br/>Needs a look"]');
    expect(text).not.toContain("Client mail");
    expect(text.match(/n\d+\[/g)).toEqual(["n1[", "n2["]);
  });

  it("every state yields its word in the label and its class line", () => {
    const nodes = SCHEME_STATES.map((s, i) => at(`k${i}`, "knowledge", "alpha", "Knowledge base", s));
    const text = buildScheme({ nodes, edges: [] });
    SCHEME_STATES.forEach((s, i) => {
      expect(text).toContain(`n${i + 1}["Knowledge base<br/>${SCHEME_WORDS[s]}"]`);
      expect(text).toContain(`class n${i + 1} ${s}`);
    });
  });

  it("a label cannot close its node, add a click or carry markup", () => {
    const evil = 'a"]; click n1 href "x';
    const text = buildScheme({ nodes: [at("e", "mailbox", "alpha", evil, "ok"), at("s", "cli", null, "<script>alert(1)</script>", "ok")], edges: [] });
    expect(text).toContain('["a#quot;#93;#59; click n1 href #quot;x<br/>Works"]');
    expect(text).toContain("#lt;script#gt;alert#40;1#41;#lt;/script#gt;");
    expect(text).not.toMatch(/<script/);
    expect(text.split("\n").filter((l) => l.includes("click"))).toHaveLength(1);
    expect(schemeText("a\nb  #35;")).toBe("a b #35;35#59;");
  });
});
