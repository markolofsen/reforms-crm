import { describe, expect, it } from "vitest";
import { EntryError, parseEntry, renderEntry } from "../src/index";

describe("parseEntry", () => {
  it("applies the defaults of doc 16", () => {
    const e = parseEntry("---\ntitle: Hello\n---\n\nBody text.\n");
    expect(e.front).toEqual({ title: "Hello", approved: true, use: "STATE", audiences: [] });
    expect(e.body).toBe("Body text.");
  });

  it("reads every field", () => {
    const e = parseEntry(
      "---\ntitle: T\napproved: false\nuse: MARKER\naudiences: [CLIENT, ANY]\ncategory: FEES\nkind: RULE\nstages: [ENQUIRY]\nfolder: a/b\nphrasings:\n  - one\n  - two\nvalid_until: 2030-01-31\nlast_confirmed: 2026-11-01\nsource: s\nsupersedes: x\nnotion_id: abc\nnotion_edited: 2026-11-01T00:00:00.000Z\n---\nB\n",
    );
    expect(e.front).toMatchObject({ approved: false, use: "MARKER", audiences: ["CLIENT", "ANY"], phrasings: ["one", "two"], valid_until: "2030-01-31", folder: "a/b" });
  });

  it("accepts phrasings as one `|`-separated line", () => {
    expect(parseEntry("---\ntitle: T\nphrasings: a | b |\n---\n").front.phrasings).toEqual(["a", "b"]);
  });

  it.each([
    ["no front matter", "just text", /no front matter/],
    ["missing title", "---\napproved: true\n---\n", /title is required/],
    ["bad use", "---\ntitle: T\nuse: QUOTE\n---\n", /use must be STATE or MARKER/],
    ["bad approved", "---\ntitle: T\napproved: yes please\n---\n", /approved must be true or false/],
    ["bad audience", "---\ntitle: T\naudiences: [client]\n---\n", /UPPER_SNAKE_CASE/],
    ["bad date", "---\ntitle: T\nvalid_until: next week\n---\n", /ISO date/],
    ["broken yaml", "---\ntitle: [unclosed\n---\n", /not valid YAML/],
  ])("refuses %s", (_n, text, re) => {
    expect(() => parseEntry(text)).toThrow(EntryError);
    expect(() => parseEntry(text)).toThrow(re);
  });
});

describe("renderEntry", () => {
  it("is canonical and round-trips", () => {
    const e = parseEntry("---\ntitle: 'Why: colon'\nuse: MARKER\naudiences: [ANY]\nphrasings: [a, b]\n---\n\nBody\n\n");
    const text = renderEntry(e.front, e.body);
    expect(text).toBe('---\ntitle: "Why: colon"\napproved: true\nuse: MARKER\naudiences:\n  - ANY\nphrasings:\n  - a\n  - b\n---\n\nBody\n');
    expect(parseEntry(text)).toEqual(e);
    expect(renderEntry(parseEntry(text).front, parseEntry(text).body)).toBe(text);
  });
});
