import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentIndex, loadWorkflows, parseWorkflow, usage, workflowErrors } from "../src/workflows";

const BODY = "\n# T\n\n### Goal\n\nx\n\n### Steps\n\n1. y\n\n### Do not\n\n- send\n\n### Done when\n\nz\n";
const doc = (fm: Record<string, string>, body = BODY) =>
  `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;
const ok = { name: "Triage", status: "Active", run_mode: "Agent may pick", applies_to: '["Lead"]', description: '"Use when mail arrives."' };

describe("usage", () => {
  it("is one rule: Retired never, Active+pickable agent, everything else on request", () => {
    expect(usage("Retired", "Automatic")).toBe("never");
    expect(usage("Active", "Agent may pick")).toBe("agent");
    expect(usage("Active", "Automatic")).toBe("agent");
    expect(usage("Active", "Manual")).toBe("request");
    expect(usage("Draft", "Agent may pick")).toBe("request");
    expect(usage(null, null)).toBe("request");
  });
});

describe("parseWorkflow", () => {
  it("reads a good file", () => {
    const w = parseWorkflow(doc(ok), "triage.md");
    expect(w).toMatchObject({ id: "triage", name: "Triage", status: "Active", usage: "agent", appliesTo: ["Lead"], description: "Use when mail arrives." });
    expect(w.issues).toEqual([]);
  });
  it("reports a missing front matter, a bad status, a bad list and missing sections", () => {
    expect(parseWorkflow("# just text", "a.md").issues[0]?.message).toMatch(/no front matter/);
    const w = parseWorkflow(doc({ ...ok, status: "Live", applies_to: "Lead" }, "\n### Goal\n\nx\n"), "a.md");
    const msgs = w.issues.map((i) => i.message).join("|");
    expect(msgs).toMatch(/status "Live"/);
    expect(msgs).toMatch(/applies_to must be a JSON list/);
    expect(msgs).toMatch(/missing section "Steps"/);
    expect(msgs).toMatch(/missing section "Done when"/);
    expect(w.usage).toBe("request");
  });
  it("ignores headings inside code fences", () => {
    const w = parseWorkflow(doc(ok, "\n### Goal\n\n```\n### Steps\n### Done when\n```\n"), "a.md");
    expect(w.issues.map((i) => i.message)).toEqual(expect.arrayContaining(['missing section "Steps"', 'missing section "Done when"']));
  });
  it("warns, not fails, on a description that is not 'Use when'", () => {
    const w = parseWorkflow(doc({ ...ok, description: '"Triage mail."' }), "a.md");
    expect(w.issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("loadWorkflows", () => {
  it("skips README.md, sorts, flags a duplicate name, and gives the agent only Active pickable ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-"));
    mkdirSync(join(dir, "workflows"));
    const put = (f: string, t: string) => writeFileSync(join(dir, "workflows", f), t);
    put("README.md", "# readme");
    put("b.md", doc({ ...ok, name: "B", status: "Draft" }));
    put("a.md", doc({ ...ok, name: "A" }));
    put("c.md", doc({ ...ok, name: "A", status: "Retired" }));
    const all = loadWorkflows(dir);
    expect(all.map((w) => w.file)).toEqual(["a.md", "b.md", "c.md"]);
    expect(workflowErrors(all)).toBe(1);
    expect(agentIndex(all).map((w) => w.name)).toEqual(["A"]);
  });
  it("a project with no folder has none", () => {
    expect(loadWorkflows(join(tmpdir(), "no-such-project-folder"))).toEqual([]);
  });
});

describe("the starter pack (app/projects/_template/workflows)", () => {
  const template = new URL("../../../projects/_template/", import.meta.url).pathname;
  const all = loadWorkflows(template);
  it("parses without an error and starts as Draft, so nothing is picked before the owner reviews it", () => {
    expect(all.length).toBe(10);
    expect(workflowErrors(all)).toBe(0);
    expect(all.every((w) => w.status === "Draft")).toBe(true);
    expect(agentIndex(all)).toEqual([]);
  });
  it("names no real person or vertical (the core names none)", () => {
    const text = all.map((w) => readFileSync(join(template, "workflows", w.file), "utf8")).join("\n");
    expect(text).not.toMatch(/\bDan\b|island|ABOUT_DAN|notion\.so|notion\.com/i);
  });
});
