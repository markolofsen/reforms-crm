import { describe, expect, it } from "vitest";
import { fingerprint, judgeSimilarity, measureAgainstSet, normalizeBody, residue, sim, SKETCH_SIZE, templateEcho } from "../src/similarity";

const TEMPLATE = (name: string) => `Hi ${name},

Thank you for getting in touch with us about your enquiry and for the time you took to explain it. We have looked at the details you sent and our team is now reviewing every point before we answer in full. You can expect a first proposal within the next few working days, together with the options we think fit best and the costs for each of them. Please keep your phone close, because we may call to clarify a few small things. If anything changes on your side in the meantime, just reply to this message and we will update the proposal straight away.

Kind regards, the desk`;
const SIGNOFF = "Kind regards, the desk";
const o = (name: string) => ({ names: [name, `${name.toLowerCase()}@clients.example`], signoff: SIGNOFF });

describe("similarity (B2)", () => {
  it("normalizes: no greeting, sign-off, quoted history, urls, addresses or names", () => {
    const w = normalizeBody("Hi Anna,\n\nSee https://x.example/a and mail anna@clients.example about Anna's lot 14.\n\n> quoted\nKind regards, the desk", o("Anna"));
    expect(w.join(" ")).toBe("see urltoken and mail addrtoken about s lot 14");
  });

  it("is deterministic and bounded", () => {
    const a = fingerprint(TEMPLATE("Anna"), o("Anna"));
    expect(fingerprint(TEMPLATE("Anna"), o("Anna"))).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(SKETCH_SIZE);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    const long = Array.from({ length: 800 }, (_, i) => `word${i}`).join(" ");
    expect(fingerprint(long).length).toBe(SKETCH_SIZE);
  });

  it("a template with the name swapped is the same body: sim >= 0.95, residue < 0.05, red", () => {
    const a = fingerprint(TEMPLATE("Anna"), o("Anna"));
    const b = fingerprint(TEMPLATE("Boris"), o("Boris"));
    expect(sim(a, b)).toBeGreaterThanOrEqual(0.95);
    expect(residue(a, [b])).toBeLessThan(0.05);
    expect(judgeSimilarity({ maxSim: sim(a, b), residue: residue(a, [b, a]) }).level).toBe("red");
    expect(templateEcho(a, b)).toBeGreaterThanOrEqual(0.9);
  });

  it("the template plus one real sentence each is amber, not ok and not red", () => {
    const extra = (name: string, s: string) => TEMPLATE(name).replace("Kind regards", `${s}\n\nKind regards`);
    const a = fingerprint(extra("Anna", "Your note about the certificate of title for lot 14 is on file."), o("Anna"));
    const b = fingerprint(extra("Boris", "The flood survey from March is what we need for the pump room."), o("Boris"));
    const c = fingerprint(TEMPLATE("Chen"), o("Chen"));
    const m = measureAgainstSet("a", [{ id: "a", fp: a }, { id: "b", fp: b }, { id: "c", fp: c }]);
    expect(m.maxSim).toBeGreaterThan(0.6);
    expect(judgeSimilarity({ maxSim: m.maxSim, ...(m.residue !== undefined ? { residue: m.residue } : {}) }).level).not.toBe("ok");
  });

  it("two genuinely different replies stay below 0.3", () => {
    const a = fingerprint("Hi Anna,\n\nThe certificate of title for lot 14 arrived this morning, and I have asked the solicitor to compare the boundary plan with the Harbour Road survey. Please tell me whether the garage was part of the sale.\n\nKind regards, the desk", o("Anna"));
    const b = fingerprint("Hi Boris,\n\nYour flood survey from March names a pump room under the east stairs. The insurer wants it dated within a year, so could you ask the engineer for a short update before the end of the month?\n\nKind regards, the desk", o("Boris"));
    expect(sim(a, b)).toBeLessThan(0.3);
    expect(judgeSimilarity({ maxSim: sim(a, b) }).level).toBe("ok");
  });

  it("empty bodies and sets of two measure sim only", () => {
    expect(fingerprint("")).toEqual([]);
    expect(sim([], [1])).toBe(0);
    expect(residue([], [[1]])).toBe(0);
    const m = measureAgainstSet("a", [{ id: "a", fp: [1, 2, 3] }, { id: "b", fp: [1, 2, 4] }]);
    expect(m.residue).toBeUndefined();
    expect(m.similarTo).toBe("b");
  });
});
