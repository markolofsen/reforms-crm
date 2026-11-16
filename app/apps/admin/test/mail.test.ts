import { describe, expect, it } from "vitest";
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
