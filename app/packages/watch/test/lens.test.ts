import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LensKit } from "@hub/contract/lens";
import { describe, expect, it } from "vitest";
import { parseWatch } from "../src/config";
import { checkLens, lensFile, loadLens } from "../src/lens/load";
import acme from "./fixtures/packages/watch-acme/src/index";

// P144 W2: the seam. A lens is found only under <home>/packages, imported by file URL, and checked before the watcher uses it.
const fixtures = resolve(import.meta.dirname, "fixtures", "packages");

describe("a lens", () => {
  it("the acme fixture loads by file URL and is checked: its task, facets, labels and triggers", async () => {
    const r = await loadLens(fixtures, "watch-acme");
    if (!r.ok) throw new Error(r.reason);
    expect(r.lens.id).toBe("acme");
    expect(r.lens.triggers).toEqual(["broken_tool", "which_tool", "other"]);
    expect(r.lens.task.preset).toBe("window");
    expect(r.lens.task.shape).toMatchObject({ kind: "window", size: 100, overlap: 20, list: "moments", index: "message_index", refs: ["reactor_indexes"], key: "trigger" });
    expect(r.lens.task.budget).toEqual({ monthlyUsd: 2 });
    expect(r.lens.task.source).toEqual({ kind: "public_chat" });
  });

  it("is found only under the packages folder, by a plain name", () => {
    expect(lensFile(fixtures, "watch-acme")).toBe(join(fixtures, "watch-acme", "src", "index.ts"));
    expect(lensFile(fixtures, "../secrets")).toBeNull();
    expect(lensFile(fixtures, "Watch")).toBeNull();
  });

  it("names what is wrong: no module, no default export, a facet that is not a field or of the wrong kind, a foreign task", async () => {
    expect(await loadLens(fixtures, "missing")).toMatchObject({ ok: false, reason: expect.stringMatching(/^no lens at packages\/missing/) });
    expect(checkLens(undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/default export/) });
    const tweak = (f: (d: ReturnType<typeof acme>) => unknown) => (kit: LensKit) => f(acme(kit));
    expect(checkLens(tweak((d) => ({ ...d, facets: { ...d.facets, quote: "nope" } })))).toMatchObject({ ok: false, reason: 'facet field "nope" is not a field of a moment' });
    expect(checkLens(tweak((d) => ({ ...d, facets: { ...d.facets, intensity: "quote" } })))).toMatchObject({ ok: false, reason: 'facet field "quote" must be a number' });
    expect(checkLens(tweak((d) => ({ ...d, facets: { ...d.facets, keep: [{ field: "nope", equals: true }] } })))).toMatchObject({ ok: false, reason: 'keep field "nope" is not a field of a moment' });
    expect(checkLens(tweak((d) => ({ ...d, task: { name: "watch.acme", version: 1 } })))).toMatchObject({ ok: false, reason: "the task was not made by kit.defineTask" });
    expect(checkLens(tweak((d) => ({ ...d, id: "Not An Id" })))).toMatchObject({ ok: false, reason: expect.stringMatching(/^the declaration is not a lens: id/) });
  });

  it("a schema with no strict form fails at load (the dry run), not at the first request", () => {
    const bad = (kit: LensKit) => {
      const d = acme(kit);
      const Open = kit.z.object({ moments: kit.z.array(kit.z.object({ message_index: kit.z.number().int(), trigger: kit.z.enum(["a"]), quote: kit.z.string(), intensity: kit.z.number(), meta: kit.z.record(kit.z.string(), kit.z.string()) })) });
      return { ...d, task: kit.defineTask({ name: "watch.bad", version: 1, schema: Open, system: "s", window: { size: 10, overlap: 2, list: "moments" } }), facets: { trigger: "trigger", intensity: "intensity", quote: "quote", speaker: "message_index" }, window: {} };
    };
    expect(checkLens(bad)).toMatchObject({ ok: false, reason: expect.stringMatching(/^the task cannot be sent: .*open record/) });
  });

  it("a lens that throws or fails to import parks with the reason", async () => {
    expect(checkLens(() => { throw new Error("boom"); })).toEqual({ ok: false, reason: "the lens threw while declaring: boom" });
    const root = join(tmpdir(), "lenses");
    mkdirSync(join(root, "broken", "src"), { recursive: true });
    writeFileSync(join(root, "broken", "src", "index.ts"), "export default (\n");
    expect(await loadLens(root, "broken")).toMatchObject({ ok: false, reason: expect.stringMatching(/^the lens did not load/) });
  });
});

describe("watch.md", () => {
  const file = (rows: string, groups = "- @Garden_Talk\n- garden_talk\n- @tools_and_more") => `# Watch\n\n| Setting | Value |\n|---|---|\n${rows}\n\n## Groups\n\n${groups}\n`;

  it("reads the lens, the switch (off unless yes), the account, the poll and the groups (lower case, once)", () => {
    expect(parseWatch(file("| lens | watch-acme |"))).toEqual({ state: "ok", config: { lens: "watch-acme", on: false, account: "default", pollMinutes: 5, groups: ["garden_talk", "tools_and_more"] } });
    expect(parseWatch(file("| lens | watch-acme |\n| on | yes |\n| account | 123456 |\n| poll_minutes | 15 |"))).toMatchObject({ config: { on: true, account: "123456", pollMinutes: 15 } });
  });

  it("refuses what it cannot read safely", () => {
    expect(parseWatch(file("| lens | ../x |"))).toMatchObject({ state: "invalid", reason: expect.stringMatching(/^lens/) });
    expect(parseWatch(file("| lens | watch-acme |\n| poll_minutes | 1 |"))).toMatchObject({ state: "invalid", reason: expect.stringMatching(/at least 5 minutes/) });
    expect(parseWatch(file("| lens | watch-acme |", "- https://t.me/joinchat/xyz"))).toMatchObject({ state: "invalid", reason: expect.stringMatching(/not a public group username/) });
  });
});
