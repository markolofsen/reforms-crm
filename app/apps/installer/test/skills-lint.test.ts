import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAIL_MCP_READ_TOOLS, NOTION_ALLOWED } from "@hub/agent/deny";
import { NOTION_PREFIX } from "@hub/projects/notion-denied";
import { HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "@hub/agent/mcp";
import { KINDS } from "@hub/projects";
import { defaultRoot } from "../src/context";

// P129 verdict 9 (A6): the skill file is the one source, and this lint keeps it true. No generated frontmatter, no
// `skills.yaml`: every name `allowed-tools` lists exists, every hub tool the body names is listed, a SKILL.md is at most
// 10 KB (rare branches go to `references/`), and the kinds name only skills that exist.

const skillsDir = path.join(defaultRoot(), "skills");
const names = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const SKILL_MAX_BYTES = 10 * 1024;
const BUILT_IN = new Set(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
const HUB = new Set<string>([...HUB_MCP_TOOLS, ...HUB_MCP_ATTENDED_TOOLS]);
const KNOWLEDGE = new Set(["knowledge_search", "knowledge_get"]);

const text = (name: string): string => readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
function allowedTools(name: string): string[] {
  const m = /^---\n([\s\S]*?)\n---/.exec(text(name));
  const line = (m?.[1] ?? "").split("\n").find((l) => l.startsWith("allowed-tools:"));
  return (line ?? "").slice("allowed-tools:".length).trim().split(/[\s,]+/).filter(Boolean);
}
const body = (name: string): string => text(name).replace(/^---\n[\s\S]*?\n---/, "");

/** Why a name of `allowed-tools` does not exist, or null when it does. */
function unknownTool(t: string): string | null {
  if (BUILT_IN.has(t)) return null;
  const m = /^mcp__([a-z-]+)__([\w-]+)$/.exec(t);
  if (!m) return `${t}: not a built-in tool and not mcp__<server>__<tool>`;
  const [, server, tool] = m;
  if (server === "hub") return HUB.has(tool ?? "") ? null : `${t}: hub mcp has no tool ${tool}`;
  if (server === "mail-mcp") return MAIL_MCP_READ_TOOLS.includes(tool ?? "") ? null : `${t}: not one of mail-mcp's read tools`;
  if (server === "notion") return NOTION_ALLOWED.includes(tool ?? "") ? null : `${t}: not on NOTION_ALLOWED (${NOTION_PREFIX}…)`;
  if (server === "knowledge-mcp") return KNOWLEDGE.has(tool ?? "") ? null : `${t}: knowledge-mcp has no tool ${tool}`;
  return `${t}: no such server for a hub session`;
}

describe("the skill lint (P129 A6)", () => {
  it("finds the skills", () => expect(names.length).toBeGreaterThan(0));
  for (const name of names) {
    describe(name, () => {
      it("every allowed-tools name exists", () => {
        expect(allowedTools(name).map(unknownTool).filter((e) => e !== null)).toEqual([]);
      });
      it("every tool the body names is in allowed-tools", () => {
        const allowed = new Set(allowedTools(name));
        const b = body(name);
        const missing: string[] = [];
        for (const t of HUB) if (b.includes(`\`${t}\``) && !allowed.has(`mcp__hub__${t}`)) missing.push(`mcp__hub__${t}`);
        for (const m of b.matchAll(/mcp__[a-z-]+__[\w-]+/g)) if (!allowed.has(m[0]) && !unknownTool(m[0])) missing.push(m[0]);
        expect([...new Set(missing)]).toEqual([]);
      });
      it(`SKILL.md is at most ${SKILL_MAX_BYTES} bytes`, () => {
        expect(statSync(path.join(skillsDir, name, "SKILL.md")).size).toBeLessThanOrEqual(SKILL_MAX_BYTES);
      });
    });
  }
  it("the kinds name only skills that exist", () => {
    for (const k of Object.values(KINDS)) for (const s of k.skills) expect(names, `${k.id}: ${s}`).toContain(s);
  });
});
