import { describe, expect, it } from "vitest";
import { buildCut, buildScheme, SCHEME_FORMS, schemeDto, schemeNode, schemeText, worstFirst, type SchemeNode } from "./scheme";

const part = (id: string, state: SchemeNode["state"], project: string | null = "alpha"): SchemeNode => ({ id, kind: "mail-mcp", project, label: id, state, detail: "", fix: null, place: "agent" });

describe("scheme (P63 O1)", () => {
  it("is strict: a stray field (a client's address, a subject) is a parse failure, and a label is short", () => {
    expect(schemeNode.safeParse({ ...part("a", "ok"), subject: "Re: price" }).success).toBe(false);
    expect(schemeNode.safeParse({ ...part("a", "ok"), label: "x".repeat(81) }).success).toBe(false);
    expect(schemeNode.safeParse({ ...part("a", "ok"), place: "drafts" }).success).toBe(false);
    expect(schemeDto.safeParse({ nodes: [part("a", "ok")] }).success).toBe(true);
    // P81: the drawing's links are the contract's model; the reply carries none.
    expect(schemeDto.safeParse({ nodes: [part("a", "ok")], edges: [] }).success).toBe(false);
  });

  it("worst first: broken, needs a look, not checked, works; the instance's parts before a project's at one state; else the server's order", () => {
    const nodes = [part("ok1", "ok"), part("unk", "unknown"), part("warn", "warn"), part("fail-p", "fail"), part("fail-i", "fail", null), part("ok2", "ok")];
    expect(worstFirst(nodes).map((n) => n.id)).toEqual(["fail-i", "fail-p", "warn", "unk", "ok1", "ok2"]);
  });
});

const at = (id: string, kind: SchemeNode["kind"], project: string | null, label: string, state: SchemeNode["state"]): SchemeNode => ({ id, kind, project, label, state, detail: "", fix: null, place: null });

/** A saas-shaped instance: two CLIs, the Notion token, one project's parts (P81 plan S1). */
const SAAS: SchemeNode[] = [
  at("core", "core", null, "Core v0.12.23", "unknown"),
  at("cli:claude", "cli", null, "Claude Code 2.1.220", "ok"),
  at("cli:codex", "cli", null, "Codex 0.146.0", "ok"),
  at("notion:token", "notion", null, "Notion integration", "unknown"),
  at("s:box", "mailbox", "saas", "hello@example.test", "unknown"),
  at("s:mcp", "mail-mcp", "saas", "mail-mcp", "ok"),
  at("s:tools", "hub-tools", "saas", "Hub tools", "ok"),
  at("s:guard", "guard", "saas", "Guard", "unknown"),
  at("s:session", "session", "saas", "Agent sessions", "warn"),
  at("s:knowledge", "knowledge", "saas", "Knowledge base (12 entries)", "ok"),
  at("s:filters", "mail-filters", "saas", "Mail filters (3 rules)", "ok"),
  at("s:setup", "setup", "saas", "Project setup", "ok"),
  at("s:notion", "notion-db", "saas", "Notion databases", "unknown"),
  at("s:door", "send-door", "saas", "Send door", "ok"),
];

describe("buildScheme (P81, decision 0042)", () => {
  it("the wide general view: the exact text (five lanes, every block, links inside a lane, the lanes joined, a class line per standing)", () => {
    expect(buildScheme(SAAS, "wide")).toBe(
      [
        "flowchart TB",
        '  subgraph l1["In"]',
        "    direction LR",
        '    b1["You<br/>the owner"]',
        '    b2["Client mail<br/>Apple Mail, read through mail-mcp"]',
        '    b3["Messengers<br/>Telegram and WhatsApp, linked chats only"]',
        '    b4["Dropped files<br/>copied under state/drops"]',
        "  end",
        '  subgraph l2["Agent"]',
        "    direction LR",
        '    b5["Project rules<br/>project.md, session and chat rules, mail filters"]',
        '    b6["Skills and workflows<br/>skills/, the project\'s workflows"]',
        '    b7["Agent<br/>Claude Code or Codex"]',
        '    b8["Guard<br/>deny list, hooks, Notion scope"]',
        '    b5 -->|"binds"| b7',
        '    b6 -->|"the steps"| b7',
        '    b8 -.->|"denies"| b7',
        "  end",
        '  subgraph l3["Reads"]',
        "    direction LR",
        '    b9["Knowledge<br/>the project\'s entries, hub mcp"]',
        '    b10["Notion CRM<br/>the project\'s own databases"]',
        '    b11["Calendar and Drive<br/>the connectors a project attaches"]',
        '    b12["Your browser<br/>your own extension#59; the Hub adds none"]',
        "  end",
        '  subgraph l4["Hub"]',
        "    direction LR",
        '    b13["Hub tools<br/>hub mcp: drafts, focus, messengers"]',
        '    b14["Server and app.db<br/>the local API and its database"]',
        '    b15["Agent log<br/>every turn of a session"]',
        '    b16["Admin<br/>Mail, Messengers, Activity, Knowledge, Overview, Settings, Help"]',
        '    b17["LLM<br/>@hub/llm, cheap typed calls"]',
        '    b13 -->|"records"| b14',
        '    b15 -->|"Activity"| b16',
        '    b14 <-->|"live panels, focus"| b16',
        '    b14 -->|"cheap calls"| b17',
        "  end",
        '  subgraph l5["Out"]',
        "    direction LR",
        '    b18["Send policy and checks<br/>who may get a draft, the checks before Send"]',
        '    b19["Send door<br/>one draft, after your Send"]',
        '    b20["The client<br/>a reply by mail or chat"]',
        '    b18 -.->|"limits"| b19',
        '    b19 -->|"Apple Mail, Telegram, WhatsApp"| b20',
        "  end",
        '  l1 -->|"phrases, mail, files"| l2',
        '  l1 -->|"your Send, linked chats"| l4',
        '  l2 -->|"reads, updates"| l3',
        '  l2 -->|"drafts, focus, every turn"| l4',
        '  l4 -->|"one draft"| l5',
        "  class b2,b5,b9,b13,b19 ok",
        "  class b7 warn",
      ].join("\n"),
    );
  });

  it("the narrow general view stacks every lane's blocks and makes the lanes one column", () => {
    const text = buildScheme(SAAS, "narrow");
    expect(text.split("\n")[0]).toBe("flowchart TB");
    expect(text.match(/direction TB/g)).toHaveLength(5);
    expect(text).toContain("    b1 ~~~ b2 ~~~ b3 ~~~ b4");
    expect(text).toContain("    b13 ~~~ b14 ~~~ b15 ~~~ b16 ~~~ b17");
    // Reads and Hub are both reached from Agent: an invisible link puts Hub under Reads.
    expect(text).toContain("  l3 ~~~ l4");
    expect(text).not.toContain("l1 ~~~ l2");
  });

  it("one Agent for two CLIs, one view for two projects (never a cluster per project), a block's worst checked part, unchecked parts no class", () => {
    const two = [...SAAS, at("r:box", "mailbox", "realty", "info@example.test", "ok"), at("r:door", "send-door", "realty", "Send door", "fail")];
    const text = buildScheme(two, "wide");
    expect(text.match(/subgraph/g)).toHaveLength(5);
    expect(text.match(/\["Agent<br\/>/g)).toHaveLength(1);
    expect(text).not.toMatch(/Claude Code 2|saas|realty/);
    expect(text).toContain('b2["Client mail<br/>2 mailboxes, read through mail-mcp"]');
    expect(text).toContain("class b19 fail");
    expect(text).not.toMatch(/class [^\n]*\bb(8|10|14)\b/);
  });

  it("no part at all: no class line, plain boxes", () => {
    expect(buildScheme([], "wide")).not.toContain("class ");
  });
});

describe("buildCut (P81)", () => {
  it("a mail reply is a straight chain: each block once, its links in order; wide left to right, narrow top to bottom", () => {
    const text = buildCut("mail-reply", SAAS, "wide");
    const lines = text.split("\n");
    expect(lines[0]).toBe("flowchart LR");
    expect(lines.filter((l) => /^  b\d+\[/.test(l))).toHaveLength(9);
    expect(lines[1]).toBe('  b1["Client mail<br/>Apple Mail, read through mail-mcp"]');
    expect(text).toContain('  b1 -->|"mail filters"| b2');
    expect(text).toContain('  b3 -->|"draft_write"| b4');
    expect(buildCut("mail-reply", SAAS, "narrow").split("\n")[0]).toBe("flowchart TB");
  });

  it("what a session is given is a fan-in into Agent, the guard dotted", () => {
    const text = buildCut("session", SAAS, "wide");
    const agent = /  (b\d+)\["Agent<br/.exec(text)?.[1];
    expect(agent).toBeDefined();
    const into = text.split("\n").filter((l) => l.endsWith(` ${agent}`));
    expect(into.length).toBeGreaterThanOrEqual(9);
    expect(into.filter((l) => l.includes("-.->"))).toHaveLength(1);
  });
});

describe("labels are text (decision 0035 point 4)", () => {
  it("schemeText codes everything that could close a label or start syntax", () => {
    const evil = 'a"]; click n1 href "x';
    expect(schemeText(evil)).toBe("a#quot;#93;#59; click n1 href #quot;x");
    expect(schemeText("<script>alert(1)</script>")).toBe("#lt;script#gt;alert#40;1#41;#lt;/script#gt;");
    expect(schemeText("a\nb  #35;")).toBe("a b #35;35#59;");
  });

  it("every fixed word of the model is plain: no line of any drawing carries a click, a script or raw markup", () => {
    for (const f of SCHEME_FORMS) {
      const all = [buildScheme(SAAS, f), ...(["mail-reply", "messenger-message", "session"] as const).map((c) => buildCut(c, SAAS, f))].join("\n");
      expect(all).not.toMatch(/click|<script|<a |href/i);
      expect(all.replace(/<br\/>/g, "")).not.toMatch(/[<>](?!-|\|)/);
    }
  });
});
