import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandForKey, matchProjectKeys, optionForKey, projectKey, projectsWithKey } from "../src/brands";

// P145 K1 (decision 0053): one rule names a project everywhere. The names live in test/fixtures/brands (core test code names no owner).
const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "brands", "keys.json"), "utf8")) as { rows: Array<{ key: string; names: string[] }>; liveLeadsBrand: string[]; brands: string[] };

describe("projectKey", () => {
  it.each(fx.rows)("every name of $key gives $key", ({ key, names }) => {
    for (const n of names) expect(projectKey(n), n).toBe(key);
  });

  it("keeps lower-case letters and digits only", () => {
    expect(projectKey("  A-b_c 1.2 ")).toBe("abc12");
    expect(projectKey("Ünïcode")).toBe("ncode");
    expect(projectKey("")).toBe("");
    expect(projectKey(null)).toBe("");
  });

  it("no two rows of the keys table share a key", () => {
    expect(new Set(fx.rows.map((r) => r.key)).size).toBe(fx.rows.length);
  });
});

describe("optionForKey", () => {
  it("finds the option as Notion holds it, from any spelling", () => {
    expect(optionForKey(fx.liveLeadsBrand, "caribbean-mls")).toBe("Caribbean MLS");
    expect(optionForKey(fx.liveLeadsBrand, "CMDOP")).toBe("cmdop");
  });

  it("picks none when no option or two options match", () => {
    expect(optionForKey(fx.liveLeadsBrand, "toponimo")).toBeNull();
    expect(optionForKey(["Reforms", "reforms"], "reforms")).toBeNull();
    expect(optionForKey(fx.liveLeadsBrand, "--")).toBeNull();
  });
});

describe("matchProjectKeys and brandForKey", () => {
  it("pairs each brand row with its options and lists the options no row claims, never Other", () => {
    const { rows, unclaimed } = matchProjectKeys(fx.brands.map((name) => ({ name })), fx.liveLeadsBrand);
    expect(rows.find((r) => r.brand === "CMDOP")?.matched).toEqual(["cmdop"]);
    expect(rows.find((r) => r.brand === "GPT-Kino")?.matched).toEqual([]);
    expect(unclaimed).toEqual(["Caribbean MLS", "Dan Merriam"]);
  });

  it("finds the brand row of a key", () => {
    expect(brandForKey(fx.brands.map((name) => ({ name })), "mls-bali")?.name).toBe("MLS Bali");
    expect(brandForKey(fx.brands.map((name) => ({ name })), "secret-bay")).toBeNull();
  });
});

describe("projectsWithKey", () => {
  it("adds the matching option and keeps every option the card had", () => {
    expect(projectsWithKey(["Reforms"], ["carapis", "cmdop", "Reforms"], "cmdop")).toEqual(["Reforms", "cmdop"]);
  });

  it("changes nothing when the card has it already or no single option matches", () => {
    expect(projectsWithKey(["cmdop"], ["carapis", "cmdop"], "CMDOP")).toBeNull();
    expect(projectsWithKey([], ["carapis"], "toponimo")).toBeNull();
  });
});
