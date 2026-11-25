import { describe, expect, it } from "vitest";
import type { LensScripts } from "@hub/contract/lens";
import { authorKey, scriptAuthors } from "../src/analyse/scripts";

// P144 W5: the cross-author script rule, ported from the experiment's shill.py (made-up texts only).
const rule: LensScripts = { rules: [{ words: 6, authors: 2 }, { words: 5, authors: 3 }], common: ["i", "am", "so", "the", "of", "these", "by", "my", "is"] };
const m = (senderId: string | null, text: string, senderHandle: string | null = null) => ({ senderId, senderHandle, text });

describe("scriptAuthors", () => {
  it("marks every author of a six-word sequence two authors share, and nobody else", () => {
    const got = scriptAuthors([m("1", "man i am so tired of losing on random garden tips"), m("2", "honestly so tired of losing on random garden tips lately"), m("3", "my mower broke again today")], rule);
    expect([...got].sort()).toEqual(["1", "2"]);
  });

  it("needs three authors for a five-word sequence", () => {
    const five = "tired of losing random garden";
    expect(scriptAuthors([m("1", `${five} one`), m("2", `${five} two`)], rule).size).toBe(0);
    expect(scriptAuthors([m("1", `${five} one`), m("2", `two ${five}`), m("3", `x ${five}`)], rule).size).toBe(3);
  });

  it("ignores common-word sequences, links, digits and one author repeating himself", () => {
    const common = "i am so the of these by my is i am";
    expect(scriptAuthors([m("1", common), m("2", common)], rule).size).toBe(0);
    const link = "see https://example.test/a/very/long/shared/link/path";
    expect(scriptAuthors([m("1", link), m("2", link)], rule).size).toBe(0);
    const again = "tired of losing on random garden tips";
    expect(scriptAuthors([m("1", again), m("1", again)], rule).size).toBe(0);
  });

  it("keys an author by id, else handle; a message with neither is never marked; no rule marks nobody", () => {
    const t = "tired of losing on random garden tips";
    expect([...scriptAuthors([m(null, t, "@a"), m(null, t, "@b"), m(null, t)], rule)].sort()).toEqual(["@a", "@b"]);
    expect(authorKey({ senderId: null, senderHandle: null })).toBeNull();
    expect(scriptAuthors([m("1", t), m("2", t)], undefined).size).toBe(0);
  });
});
