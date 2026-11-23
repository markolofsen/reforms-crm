import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELDS } from "../src/parse";
import { KIND_IDS } from "../src/kinds";

// Doc 16 section 3 lists every field; the code (fields.ts) is the source, so the doc may not fall behind it.
const doc = resolve(import.meta.dirname, "../../../../@docs/core/16-projects-and-knowledge.md");

describe.skipIf(!existsSync(doc))("doc 16 matches the schema", () => {
  const text = existsSync(doc) ? readFileSync(doc, "utf8") : "";
  it("every Settings field has a row in the fields table", () => {
    const missing = Object.keys(FIELDS).filter((f) => !text.includes(`| \`${f}\` |`));
    expect(missing).toEqual([]);
  });
  it("every kind is described in section 3A", () => {
    const missing = KIND_IDS.filter((k) => !text.includes(`| \`${k}\` |`));
    expect(missing).toEqual([]);
  });
});
