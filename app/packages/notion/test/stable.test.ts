import { describe, expect, it } from "vitest";
import { normalizePage, sha256, stableStringify } from "../src/stable";
import { createThrottle } from "../src/throttle";

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } })).toBe(stableStringify({ a: { c: [{ y: 2, z: 1 }], d: 1 }, b: 1 }));
  });
  it("ends with a newline", () => {
    expect(stableStringify({}).endsWith("\n")).toBe(true);
  });
});

describe("normalizePage", () => {
  const withFile = (url: string, expiry: string) => ({
    properties: { Docs: { type: "files", files: [{ name: "a", type: "file", file: { url, expiry_time: expiry } }] } },
  });

  it("drops the signature and expiry of hosted files so two runs match", () => {
    const a = normalizePage(withFile("https://s3/a.pdf?sig=1", "2026-11-14T10:00:00Z"));
    const b = normalizePage(withFile("https://s3/a.pdf?sig=2", "2026-11-14T11:00:00Z"));
    expect(sha256(stableStringify(a))).toBe(sha256(stableStringify(b)));
    expect(JSON.stringify(a)).toContain("https://s3/a.pdf");
    expect(JSON.stringify(a)).not.toContain("sig=");
  });

  it("leaves external files and other values alone", () => {
    const page = { properties: { L: { type: "url", url: "https://x.example/?a=1" }, F: { type: "files", files: [{ type: "external", external: { url: "https://y/?k=1" } }] } } };
    expect(normalizePage(page)).toEqual(page);
  });
});

describe("createThrottle", () => {
  it("spaces requests by the minimum interval", async () => {
    let now = 1000;
    const slept: number[] = [];
    const gate = createThrottle(300, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });
    await gate();
    await gate();
    await gate();
    expect(slept).toEqual([300, 300]);
    now += 1000;
    await gate();
    expect(slept).toEqual([300, 300]);
  });
});
