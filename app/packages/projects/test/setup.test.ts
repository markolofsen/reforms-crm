import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runProjectSetup } from "../src/hub-commands.js";

// P36 U4: `hub project setup` answers tone, signoff and languages in one pass.
const here = dirname(fileURLToPath(import.meta.url));
function rig() {
  const root = join(mkdtempSync(join(tmpdir(), "hub-setup-")), "projects");
  cpSync(join(here, "fixtures", "projects"), root, { recursive: true });
  const md = join(root, "acme-travel", "project.md");
  const text = readFileSync(md, "utf8").split("\n").filter((l) => !/^\| (tone|signoff) \|/.test(l)).map((l) => l.replace(/^\| status \| \w+ \|/, "| status | draft |")).join("\n");
  writeFileSync(md, text);
  const lines: string[] = [];
  return { root, md, lines, o: { projectsRoot: root, out: (l: string) => lines.push(l) } };
}

describe("hub project setup", () => {
  it("writes the flags as the owner's answers", async () => {
    const r = rig();
    expect(await runProjectSetup("acme-travel", { tone: "warm and brief", signoff: "Best, Acme" }, r.o)).toBe(0);
    const md = readFileSync(r.md, "utf8");
    expect(md).toMatch(/\| tone \| warm and brief \| \d{4}-\d{2}-\d{2} \| owner \|/);
    expect(md).toMatch(/\| signoff \| Best, Acme \|/);
    expect(r.lines.join("\n")).toContain("wrote 2 setting(s)");
  });
  it("asks only for what is empty, and Enter skips", async () => {
    const r = rig();
    const asked: string[] = [];
    const answers = ["calm", ""];
    expect(await runProjectSetup("acme-travel", {}, r.o, async (q) => { asked.push(q); return answers.shift() ?? ""; })).toBe(0);
    expect(asked).toHaveLength(2);
    expect(readFileSync(r.md, "utf8")).toMatch(/\| tone \| calm \|/);
    expect(r.lines.join("\n")).toContain("skipped signoff");
    // second run: tone is answered, only signoff is asked again
    const again: string[] = [];
    await runProjectSetup("acme-travel", {}, r.o, async (q) => { again.push(q); return ""; });
    expect(again).toHaveLength(1);
  });
  it("without a terminal and without flags it changes nothing", async () => {
    const r = rig();
    const before = readFileSync(r.md, "utf8");
    expect(await runProjectSetup("acme-travel", {}, r.o)).toBe(0);
    expect(readFileSync(r.md, "utf8")).toBe(before);
    expect(r.lines.join("\n")).toContain("nothing to change");
  });
  it("refuses an invalid language tag and leaves the file alone", async () => {
    const r = rig();
    const before = readFileSync(r.md, "utf8");
    expect(await runProjectSetup("acme-travel", { languages: "not a tag" }, r.o)).toBe(1);
    expect(readFileSync(r.md, "utf8")).toBe(before);
  });
});
