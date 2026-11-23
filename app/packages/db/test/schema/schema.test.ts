import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../src/schema/index";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/schema");
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts");

// P126 DB1: the schema is one file per subject; `index.ts` is the one object drizzle reads and defines nothing itself.
describe("the schema by subject", () => {
  it("each subject file stays under the size cap", () => {
    for (const f of files) expect(readFileSync(join(DIR, f), "utf8").split("\n").length, f).toBeLessThanOrEqual(300);
  });
  it("defines every table in exactly one subject file, and index.ts only re-exports them", () => {
    const tables = Object.values(schema).filter((v) => is(v, SQLiteTable)).map((t) => getTableName(t as SQLiteTable));
    expect(new Set(tables).size).toBe(tables.length);
    const defined = files.flatMap((f) => [...readFileSync(join(DIR, f), "utf8").matchAll(/sqliteTable\(\s*"(\w+)"/g)].map((m) => m[1]));
    expect(defined.sort()).toEqual([...tables].sort());
    expect(readFileSync(join(DIR, "index.ts"), "utf8")).not.toMatch(/sqliteTable/);
  });
});
