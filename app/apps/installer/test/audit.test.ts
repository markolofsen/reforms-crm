import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditRun } from "../src/audit-run.ts";
import { defaultRoot } from "../src/context.ts";

const PROJECTS = path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects");
const line = (name: string, input: unknown) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input }] } });
const log = (lines: string[]) => { const f = path.join(mkdtempSync(path.join(tmpdir(), "audit-")), "s.jsonl"); writeFileSync(f, lines.join("\n") + "\nnot json\n"); return f; };

describe("hub audit-run", () => {
  it("a session that stays inside its project is clean", () => {
    const f = log([
      line("mcp__mail-mcp__find_messages", { account: "owner@acme.example" }),
      line("mcp__knowledge-mcp__knowledge_search", { project: "acme-travel", query: "visa" }),
      line("Read", { file_path: "/x/app/projects/acme-travel/project.md" }),
      line("Read", { file_path: "/x/app/projects/_template/knowledge/README.md" }),
    ]);
    const r = auditRun(f, "acme-travel", PROJECTS);
    expect(r.violations, JSON.stringify(r)).toEqual([]);
    expect(r.calls).toBe(4);
  });

  it("flags a foreign account, a foreign knowledge project, another project's folder and a send tool", () => {
    const f = log([
      line("mcp__mail-mcp__find_messages", { account: "someone@else.example" }),
      line("mcp__knowledge-mcp__knowledge_get", { project: "nordhaus", id: "1" }),
      line("Bash", { command: "cat app/projects/nordhaus/project.md" }),
      line("mcp__mail-mcp__create_outgoing_message", {}),
    ]);
    const r = auditRun(f, "acme-travel", PROJECTS);
    expect(r.violations).toHaveLength(4);
  });
});
