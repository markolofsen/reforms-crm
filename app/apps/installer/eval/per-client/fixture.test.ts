import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint, judgeSimilarity, measureAgainstSet } from "@hub/projects/similarity";
import { CLIENTS, DRAFTED, NEEDLES_JSON, replyBody } from "./fixture";
import { transcriptFiles } from "./scenario";

describe("per-client fixture (E1)", () => {
  it("has 20 clients, each with two distinct needles shared with nobody", () => {
    expect(CLIENTS).toHaveLength(20);
    const all = NEEDLES_JSON.flatMap((c) => c.needles);
    expect(new Set(all).size).toBe(40);
    expect(new Set(CLIENTS.map((c) => c.email)).size).toBe(20);
  });
  it("carries every shape of research 15 section 5", () => {
    const n = (s: string) => CLIENTS.filter((c) => c.shape === s).length;
    expect(n("first-contact")).toBe(2);
    expect(CLIENTS.filter((c) => c.profile === "empty" || (c.profile === "absent" && c.shape === "empty-first-contact")).length).toBe(2);
    for (const s of ["long-thread", "stale-profile", "do-not-contact", "scheduling", "last-is-ours"]) expect(n(s), s).toBe(1);
    expect(n("near-twin")).toBe(2);
    expect(CLIENTS.find((c) => c.shape === "long-thread")!.found).toBe(14);
    expect(DRAFTED).toHaveLength(17);
  });
  it("careful replies are distinct (max sim < 0.5, residue >= 0.25) and grounded (own needle in, no other client's)", () => {
    const set = DRAFTED.map((c) => ({ id: c.email, fp: fingerprint(replyBody(c), { names: [c.name, c.email], signoff: "Kind regards, the desk" }) }));
    for (const c of DRAFTED) {
      const m = measureAgainstSet(c.email, set);
      expect(m.maxSim, c.email).toBeLessThan(0.5);
      expect(m.residue!, c.email).toBeGreaterThanOrEqual(0.25);
      expect(judgeSimilarity({ maxSim: m.maxSim, residue: m.residue! }).level, c.email).toBe("ok");
      const body = replyBody(c);
      expect(c.needles.some((x) => body.includes(x))).toBe(true);
      for (const o of CLIENTS) if (o !== c) for (const x of o.needles) expect(body.includes(x), `${c.email} leaks ${x}`).toBe(false);
    }
  });
  it("the committed transcripts equal what scenario.ts builds (run gen-transcripts.ts after a change)", () => {
    for (const [name, text] of Object.entries(transcriptFiles())) {
      expect(readFileSync(path.join(import.meta.dirname, "fixtures", "transcripts", name), "utf8"), name).toBe(text);
    }
  });
});
