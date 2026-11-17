import { describe, expect, it } from "vitest";
import { composeHref } from "../src/lib/external";
import { mailLink } from "../src/lib/mail";

describe("mailLink", () => {
  it("builds a message:// link from a Message-ID with or without brackets", () => {
    expect(mailLink("<abc@host.example>")).toBe("message://%3Cabc%40host.example%3E");
    expect(mailLink("abc@host.example")).toBe("message://%3Cabc%40host.example%3E");
  });
  it("has no link for anything else", () => {
    expect(mailLink(null)).toBeNull();
    expect(mailLink("draft-12")).toBeNull();
    expect(mailLink("two words@host")).toBeNull();
  });
});

describe("composeHref", () => {
  const base = { toAddr: "a@x.com", ccAddr: null, subject: "Hello" };
  it("addresses one recipient", () => {
    expect(composeHref(base)).toBe("mailto:a%40x.com?subject=Hello");
  });
  it("separates several recipients with a literal comma, each encoded alone", () => {
    expect(composeHref({ ...base, toAddr: "a@x.com, b@y.com;c@z.org" })).toBe("mailto:a%40x.com,b%40y.com,c%40z.org?subject=Hello");
  });
  it("carries Cc the same way", () => {
    expect(composeHref({ ...base, ccAddr: "d@x.com, e@y.com" })).toBe("mailto:a%40x.com?subject=Hello&cc=d%40x.com,e%40y.com");
    expect(composeHref({ ...base, ccAddr: "  " })).toBe("mailto:a%40x.com?subject=Hello");
  });
  it("encodes a subject with &, + and spaces", () => {
    expect(composeHref({ ...base, subject: "Terms & fees +10%" })).toBe("mailto:a%40x.com?subject=Terms%20%26%20fees%20%2B10%25");
  });
});
