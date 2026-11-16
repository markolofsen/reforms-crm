import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runDump } from "../src/dump.js";
import type { Project } from "../src/types.js";
import { DS_CLIENTS, DS_LEADS, FakeReader, makePage, sampleDbs } from "./helpers.js";

const project: Project = {
  name: "demo",
  folder: "/unused",
  databases: [
    { slug: "clients", dataSourceId: DS_CLIENTS },
    { slug: "leads", dataSourceId: DS_LEADS },
  ],
};
const ADA = "aaaa0001-0000-0000-0000-000000000001";

let out: string;
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "dump-"));
});

async function readTree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) Object.assign(files, await readTree(path, `${prefix}${name}/`));
    else files[`${prefix}${name}`] = await readFile(path, "utf8");
  }
  return files;
}

describe("runDump", () => {
  it("writes schema, pages (json + markdown), an index and a manifest with counts and a hash", async () => {
    const m = await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
    expect(m.totals).toEqual({ databases: 2, pages: 4, markdown_truncated: 1, errors: 0 });
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.databases.map((d) => [d.slug, d.pages])).toEqual([["clients", 3], ["leads", 1]]);

    const files = await readTree(join(out, "2026-11-14"));
    expect(Object.keys(files)).toContain("clients/schema.json");
    expect(Object.keys(files)).toContain("clients/index.md");
    expect(files[`clients/pages/${ADA}.md`]).toBe("# Ada\n\nLong history.\n");
    expect(JSON.parse(files[`clients/pages/${ADA}.json`] ?? "{}").properties.Name.title[0].plain_text).toBe("Ada Client");
    expect(files["clients/index.md"]).toContain("| Ada Client |");
    expect(JSON.parse(files["manifest.json"] ?? "{}").sha256).toBe(m.sha256);
  });

  it("marks a truncated page body instead of hiding it", async () => {
    await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
    const md = await readFile(join(out, "2026-11-14", "clients", "pages", "aaaa0003-0000-0000-0000-000000000003.md"), "utf8");
    expect(md).toContain("notion-dump: truncated");
    expect(md).toContain("blk-1");
  });

  it("strips expiring file signatures from the stored page", async () => {
    await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
    const json = await readFile(join(out, "2026-11-14", "clients", "pages", `${ADA}.json`), "utf8");
    expect(json).toContain("https://s3.example/a.pdf");
    expect(json).not.toContain("X-Amz-Signature");
    expect(json).not.toContain("expiry_time");
  });

  it("is idempotent: a second run on the same date gives the same bytes and the same hash", async () => {
    const a = await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
    const first = await readTree(join(out, "2026-11-14"));
    const reader = new FakeReader(sampleDbs());
    const b = await runDump({ project, outDir: out, date: "2026-11-14", reader });
    expect(b.sha256).toBe(a.sha256);
    expect(await readTree(join(out, "2026-11-14"))).toEqual(first);
    expect(reader.calls.retrieveMarkdown).toBe(0); // unchanged pages are reused
  });

  it("does not depend on the order Notion returns pages in", async () => {
    const a = await runDump({ project, outDir: out, date: "2026-11-13", reader: new FakeReader(sampleDbs()) });
    const dbs = sampleDbs();
    dbs[DS_CLIENTS]!.pages.reverse();
    const b = await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(dbs), reuse: false });
    expect(b.sha256).toBe(a.sha256);
  });

  it("fetches markdown only for pages edited since the previous dump", async () => {
    await runDump({ project, outDir: out, date: "2026-11-13", reader: new FakeReader(sampleDbs()) });
    const dbs = sampleDbs();
    dbs[DS_CLIENTS]!.pages[1] = makePage("aaaa0002-0000-0000-0000-000000000002", "Ben Client", {}, "2026-11-14T08:00:00.000Z");
    dbs[DS_CLIENTS]!.bodies["aaaa0002-0000-0000-0000-000000000002"] = "Edited note.\n";
    const reader = new FakeReader(dbs);
    const m = await runDump({ project, outDir: out, date: "2026-11-14", reader });
    expect(reader.markdownFor).toEqual(["aaaa0002-0000-0000-0000-000000000002"]);
    expect(await readFile(join(out, "2026-11-14", "clients", "pages", "aaaa0002-0000-0000-0000-000000000002.md"), "utf8")).toBe("Edited note.\n");
    expect(m.totals.markdown_truncated).toBe(1); // the reused truncated body still counts
  });

  it("ignores an unfinished earlier dump (no manifest) as a reuse source", async () => {
    await runDump({ project, outDir: out, date: "2026-11-13", reader: new FakeReader(sampleDbs()) });
    await rm(join(out, "2026-11-13", "manifest.json"));
    const reader = new FakeReader(sampleDbs());
    await runDump({ project, outDir: out, date: "2026-11-14", reader });
    expect(reader.calls.retrieveMarkdown).toBe(4);
  });

  it("removes files of pages that vanished between two runs of the same day", async () => {
    await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
    const dbs = sampleDbs();
    dbs[DS_CLIENTS]!.pages.pop();
    const m = await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(dbs) });
    expect(m.databases[0]?.pages).toBe(2);
    const names = await readdir(join(out, "2026-11-14", "clients", "pages"));
    expect(names.some((n) => n.startsWith("aaaa0003"))).toBe(false);
  });

  it("records a failing database and still dumps the others", async () => {
    const dbs = sampleDbs();
    dbs[DS_CLIENTS]!.fail = "restricted_resource: not shared with the integration";
    const m = await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(dbs) });
    expect(m.totals.errors).toBe(1);
    expect(m.databases[0]?.error).toMatch(/not shared/);
    expect(m.databases[1]?.pages).toBe(1);
  });

  it("limits the run with `only` and rejects an unknown slug", async () => {
    const reader = new FakeReader(sampleDbs());
    const m = await runDump({ project, outDir: out, date: "2026-11-14", reader, only: ["leads"] });
    expect(m.databases.map((d) => d.slug)).toEqual(["leads"]);
    await expect(runDump({ project, outDir: out, date: "2026-11-14", reader, only: ["nope"] })).rejects.toThrow(/nope/);
  });
});
