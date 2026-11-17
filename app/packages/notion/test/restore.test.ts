import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runDump } from "../src/dump";
import { diffSchema, planRestore, renderPlan, resolveDumpDir } from "../src/restore";
import type { Project } from "../src/types";
import { DS_CLIENTS, DS_LEADS, FakeReader, makePage, sampleDbs, select } from "./helpers";

const project: Project = {
  name: "demo",
  folder: "/unused",
  databases: [
    { slug: "clients", dataSourceId: DS_CLIENTS },
    { slug: "leads", dataSourceId: DS_LEADS },
  ],
};
const ADA = "aaaa0001-0000-0000-0000-000000000001";
const BEN = "aaaa0002-0000-0000-0000-000000000002";
const CY = "aaaa0003-0000-0000-0000-000000000003";

let out: string;
let dumpDir: string;
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "restore-"));
  await runDump({ project, outDir: out, date: "2026-11-14", reader: new FakeReader(sampleDbs()) });
  dumpDir = join(out, "2026-11-14");
});

describe("planRestore", () => {
  it("reports an identical live state as nothing to do", async () => {
    const plan = await planRestore(dumpDir, new FakeReader(sampleDbs()));
    expect(plan.totals).toEqual({ wouldRecreate: 0, changedSinceDump: 0, newInLive: 0, errors: 0 });
    expect(plan.databases.map((d) => d.unchanged)).toEqual([3, 1]);
  });

  it("lists a page deleted in Notion as one that would be recreated, with what it cannot write", async () => {
    const live = sampleDbs();
    live[DS_CLIENTS]!.pages = live[DS_CLIENTS]!.pages.filter((p) => p.id !== ADA);
    const plan = await planRestore(dumpDir, new FakeReader(live));
    const missing = plan.databases[0]!.missing;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ id: ADA, title: "Ada Client", hasBody: true });
    expect(missing[0]!.skippedReadOnly).toEqual(["Created"]);
    expect(missing[0]!.relations).toEqual([{ name: "Leads", count: 1 }]);
    expect(missing[0]!.writable).toEqual(["Docs", "Grade", "Leads", "Name"]);
  });

  it("reports changed pages by property and leaves them alone", async () => {
    const live = sampleDbs();
    live[DS_CLIENTS]!.pages[1] = makePage(BEN, "Ben Client", { Grade: select("Priority") }, "2026-11-14T09:00:00.000Z");
    const plan = await planRestore(dumpDir, new FakeReader(live));
    expect(plan.databases[0]!.changed).toEqual([{ id: BEN, title: "Ben Client", properties: ["Grade"] }]);
    expect(plan.totals.wouldRecreate).toBe(0);
  });

  it("does not call a changed formula or rollup a difference", async () => {
    const dbs = sampleDbs();
    dbs[DS_CLIENTS]!.pages[2] = makePage(CY, "Cy Client", { Open: { id: "o", type: "rollup", rollup: { number: 1 } } });
    const dir = await mkdtemp(join(tmpdir(), "restore2-"));
    await runDump({ project, outDir: dir, date: "2026-11-14", reader: new FakeReader(dbs) });
    const live = sampleDbs();
    live[DS_CLIENTS]!.pages[2] = makePage(CY, "Cy Client", { Open: { id: "o", type: "rollup", rollup: { number: 9 } } });
    const plan = await planRestore(join(dir, "2026-11-14"), new FakeReader(live));
    expect(plan.totals.changedSinceDump).toBe(0);
  });

  it("counts pages that exist only in Notion", async () => {
    const live = sampleDbs();
    live[DS_LEADS]!.pages.push(makePage("bbbb0002-0000-0000-0000-000000000002", "Newer lead"));
    const plan = await planRestore(dumpDir, new FakeReader(live));
    expect(plan.databases[1]!.newInLive).toBe(1);
  });

  it("reports schema drift: a missing property, a changed type and a missing option", async () => {
    const live = sampleDbs();
    const props = live[DS_CLIENTS]!.info.properties;
    delete props.Created;
    props.Grade = { type: "select", select: { options: [{ name: "Standard" }] } };
    live[DS_LEADS]!.info.properties.Status = { type: "rich_text" };
    const plan = await planRestore(dumpDir, new FakeReader(live));
    expect(plan.databases[0]!.schema.missingProperties).toEqual([{ name: "Created", type: "created_time" }]);
    expect(plan.databases[0]!.schema.missingOptions).toEqual([{ name: "Grade", options: ["Priority", "Low"] }]);
    expect(plan.databases[1]!.schema.changedTypes).toEqual([{ name: "Status", dumped: "select", live: "rich_text" }]);
  });

  it("reports an unreachable database as an error and keeps going", async () => {
    const live = sampleDbs();
    live[DS_CLIENTS]!.fail = "restricted_resource";
    const plan = await planRestore(dumpDir, new FakeReader(live));
    expect(plan.totals.errors).toBe(1);
    expect(plan.databases[0]!.error).toMatch(/restricted/);
    expect(plan.databases[1]!.unchanged).toBe(1);
  });

  it("only reads: no markdown is fetched for a dry run", async () => {
    const reader = new FakeReader(sampleDbs());
    await planRestore(dumpDir, reader);
    expect(reader.calls.retrieveMarkdown).toBe(0);
  });
});

describe("renderPlan", () => {
  it("states that nothing was written and lists what would be recreated", async () => {
    const live = sampleDbs();
    live[DS_CLIENTS]!.pages = live[DS_CLIENTS]!.pages.filter((p) => p.id !== ADA);
    const text = renderPlan(await planRestore(dumpDir, new FakeReader(live)));
    expect(text).toContain("Nothing was written to Notion");
    expect(text).toContain("would recreate 1 page(s)");
    expect(text).toContain("Ada Client");
    expect(text).toContain("relations to remap: Leadsx1");
    expect(text).toContain("Total: would recreate 1");
  });
});

describe("diffSchema", () => {
  it("is empty for equal schemas", () => {
    const props = { A: { type: "select", select: { options: [{ name: "x" }] } } };
    expect(diffSchema(props, props)).toEqual({ missingProperties: [], changedTypes: [], missingOptions: [] });
  });
});

describe("resolveDumpDir", () => {
  it("picks the newest complete dump and refuses an empty folder", async () => {
    expect(await resolveDumpDir(out)).toBe(dumpDir);
    expect(await resolveDumpDir(out, "2026-01-01")).toBe(join(out, "2026-01-01"));
    await expect(resolveDumpDir(join(out, "empty"))).rejects.toThrow(/No complete dump/);
  });
});
