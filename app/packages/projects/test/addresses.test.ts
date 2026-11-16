import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAddresses } from "../src/hub-commands.js";
import { proposeAddresses, type RoutingSnapshot } from "../src/addresses.js";

// P36 U5: which addresses reach a project through forwarding rules.
const rule = (to: string | null, dest: string, enabled = true) => ({ enabled, matchers: [to ? { type: "literal", field: "to", value: to } : { type: "all" }], actions: [{ type: "forward", value: [dest] }] });
const SNAP: RoutingSnapshot = {
  "carapis.com": { rules: [rule("Info@Carapis.com", "hello@reforms.ai"), rule("sales@carapis.com", "someone@else.test"), rule(null, "hello@reforms.ai")] },
  "gptkino.com": { rules: [rule("info@gptkino.com", "hello@reforms.ai"), rule("old@gptkino.com", "hello@reforms.ai", false)] },
};
const PROJECT = { accounts: ["hello@reforms.ai"], addresses: ["hello@reforms.ai", "info@gptkino.com"], aliases: ["info@gptkino.com"] };

describe("proposeAddresses", () => {
  it("lists literal recipients that forward into the project, skips other targets and disabled rules, reports catch-all by zone", () => {
    expect(proposeAddresses(SNAP, PROJECT)).toEqual({ add: ["info@carapis.com"], known: ["info@gptkino.com"], catchAll: ["carapis.com"] });
  });
  it("matches on the account too, and an empty snapshot proposes nothing", () => {
    expect(proposeAddresses(SNAP, { accounts: ["hello@reforms.ai"], addresses: [], aliases: [] }).add).toEqual(["info@carapis.com", "info@gptkino.com"]);
    expect(proposeAddresses({}, PROJECT)).toEqual({ add: [], known: [], catchAll: [] });
  });
});

describe("hub project addresses", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  function rig() {
    const root = join(mkdtempSync(join(tmpdir(), "hub-addr-")), "projects");
    cpSync(join(here, "fixtures", "projects"), root, { recursive: true });
    const md = join(root, "acme-travel", "project.md");
    const snap = join(root, "snap.json");
    const lines: string[] = [];
    return { root, md, snap, lines, o: { projectsRoot: root, out: (l: string) => lines.push(l) } };
  }
  it("is a dry run by default and writes mail.aliases with --apply", () => {
    const r = rig();
    const acct = /\| mail\.accounts \| ([^|]+?) \|/.exec(readFileSync(r.md, "utf8"))![1]!.split(",")[0]!.trim();
    writeFileSync(r.snap, JSON.stringify({ "z.test": { rules: [rule("new@z.test", acct)] } }));
    const before = readFileSync(r.md, "utf8");
    expect(runAddresses("acme-travel", r.snap, false, r.o)).toBe(0);
    expect(readFileSync(r.md, "utf8")).toBe(before);
    expect(r.lines.join("\n")).toContain("+ new@z.test");
    expect(runAddresses("acme-travel", r.snap, true, r.o)).toBe(0);
    expect(readFileSync(r.md, "utf8")).toMatch(/\| mail\.aliases \|[^|]*new@z\.test[^|]*\| \d{4}-\d{2}-\d{2} \| owner \|/);
  });
  it("a bad file is one error line", () => {
    const r = rig();
    writeFileSync(r.snap, "not json");
    expect(runAddresses("acme-travel", r.snap, false, r.o)).toBe(1);
    expect(r.lines[0]).toContain("cannot read the routing snapshot");
  });
});
