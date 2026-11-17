import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffSchema, isClean, liveSchemaOf, type PackSchema } from "../src/schema-diff.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const leadsPack = JSON.parse(readFileSync(path.join(here, "..", "..", "..", "projects", "_template", "notion-crm", "schema", "leads.json"), "utf8")) as PackSchema;

// The live Leads schema as the connector returned it on 2026-11-17 (names, types, options only).
const live = {
  schema: Object.fromEntries([
    ...["Name"].map((n) => [n, { type: "title" }]),
    ["Status", { type: "select", options: ["New", "In progress", "Won", "Lost", "Spam"].map((name) => ({ name })) }],
    ["Source", { type: "select", options: ["Website", "Telegram", "Referral", "Other", "Email"].map((name) => ({ name })) }],
    ["Brand", { type: "multi_select", options: ["carapis", "Caribbean MLS", "Dan Merriam", "Reforms", "Other"].map((name) => ({ name })) }],
    ...["Received at", "Next step", "Ad click time"].map((n) => [n, { type: "date" }]),
    ["Email", { type: "email" }], ["Phone", { type: "phone_number" }], ["Page URL", { type: "url" }], ["Owner", { type: "person" }],
    ["Ad consent", { type: "checkbox" }], ["Client", { type: "relation" }],
    ...["Company", "Message", "Details", "Form", "Source page", "Locale", "Mailbox", "Notes", "Conversation summary", "Hub run id", "Ad click", "GCLID", "MSCLKID", "LinkedIn click ID", "UTM source", "UTM medium", "UTM campaign"].map((n) => [n, { type: "text" }]),
  ]),
};

describe("pack vs live", () => {
  it("the leads pack matches the live Leads of 2026-11-17", () => {
    const d = diffSchema(leadsPack, liveSchemaOf(live));
    expect(d, JSON.stringify(d)).toMatchObject({ missing: [], extra: [], typeChanged: [], optionsMissing: [] });
    expect(isClean(d)).toBe(true);
  });
  it("reports a missing option, a changed type, an unknown column and a missing property", () => {
    const l = liveSchemaOf(live);
    l.Source = { type: "select", options: [{ name: "Website" }] };
    l.Phone = { type: "text" };
    l["Brand new"] = { type: "text" };
    delete l.Company;
    const d = diffSchema(leadsPack, l);
    expect(d.optionsMissing[0]?.name).toBe("Source");
    expect(d.typeChanged).toEqual([{ name: "Phone", pack: "phone_number", live: "text" }]);
    expect(d.extra).toEqual(["Brand new"]);
    expect(d.missing).toEqual(["Company"]);
  });
  it("accepts the whole data-source-state text or the bare schema", () => {
    expect(Object.keys(liveSchemaOf(JSON.stringify(live))).length).toBe(Object.keys(liveSchemaOf(live.schema)).length);
  });
});
