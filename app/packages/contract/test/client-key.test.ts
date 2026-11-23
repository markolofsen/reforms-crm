import { describe, expect, it } from "vitest";
import { clientKey, keyText, parseClientKey } from "../src/client-key";

// P103: a client is addressed by his email, `id-<n>` only without one; the bare number is no key.
describe("client keys (P103)", () => {
  it("the email, lower-cased, else id-<n>", () => {
    expect(clientKey({ id: 7, email: " Ana@Example.COM " })).toBe("ana@example.com");
    expect(clientKey({ id: 7, email: "" })).toBe("id-7");
    expect(clientKey({ id: 7, email: null })).toBe("id-7");
    expect(clientKey({ id: 7, email: "not an address" })).toBe("id-7");
  });
  it("parses both shapes, encoded or not, and refuses the rest", () => {
    expect(parseClientKey("ana%40example.com")).toEqual({ email: "ana@example.com" });
    expect(parseClientKey("Ana@Example.com")).toEqual({ email: "ana@example.com" });
    expect(parseClientKey("id-42")).toEqual({ id: 42 });
    for (const bad of ["42", "id-0", "id-007", "abc", "", "%E0%A4%A", "a@b/c"]) expect(parseClientKey(bad), bad).toBeNull();
    expect(keyText({ email: "ana@example.com" })).toBe("ana@example.com");
    expect(keyText({ id: 3 })).toBe("id-3");
  });
});
