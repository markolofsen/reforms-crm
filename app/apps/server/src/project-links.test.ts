import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { projectLinks } from "./project-links";

const ID = "00000000000040008000000000000003";
const repos = (exists = true) => ({ projects: { get: async () => (exists ? { slug: "acme-travel" } : null) } }) as never;

describe("project Quick Links", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it("resolves a Notion database role through the read-only reader", async () => {
    const root = mkdtempSync(join(tmpdir(), "hub-links-"));
    roots.push(root);
    const project = join(root, "acme-travel");
    mkdirSync(project);
    const fixture = fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel/project.md", import.meta.url));
    const source = readFileSync(fixture, "utf8");
    writeFileSync(join(project, "project.md"), `${source}\n## Links\n\n| Group | Label | Target | Under | Answered | By |\n|---|---|---|---|---|---|\n| Notion | Clients | notion:clients |  | 2026-11-20 | agent |\n| Sites | Website | https://example.com/ |  | 2026-11-20 | owner |\n`);
    const result = await projectLinks(repos(), "acme-travel", root, { reader: { retrieveDataSource: async () => ({ id: "ds", pageId: ID, title: "Clients", properties: {} }), listPages: async function* () {}, retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }) } });
    expect(result.notion.state).toBe("ready");
    expect(result.links[0]).toMatchObject({ target: "notion:clients", href: `notion://www.notion.so/${ID}` });
    expect(result.links[1]).toMatchObject({ target: "https://example.com/", href: "https://example.com/" });
  });

  it("keeps an absent project out of the resolver", async () => {
    await expect(projectLinks(repos(false), "acme-travel", "/tmp/not-used")).rejects.toThrow(/no such project/);
  });
});
