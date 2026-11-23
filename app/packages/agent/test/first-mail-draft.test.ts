import { describe, expect, it } from "vitest";
import { FakeDraftWriter } from "@hub/mail-app/writer/fake";
import { personBrand, signAsPerson } from "../src/drafts/person";
import { writeFirstMailDraft } from "../src/drafts/write";

// P126 M3: one first write for the agent's first reply, its new thread and the owner's manual first reply; a person's
// text is signed and branded by one pair of functions.

const brand = (name: string) => ({ name, receivesAt: [`hi@${name.toLowerCase()}.example`], signature: [name], displayName: null, answered: "2026-11-23", by: "owner" as const });

describe("writeFirstMailDraft", () => {
  it("a new thread is written to the client from the visible sender, replaces nothing and carries how it was signed", async () => {
    const writer = new FakeDraftWriter();
    const r = await writeFirstMailDraft({
      writer,
      mail: { accounts: ["desk"], sender: "me@desk.example" },
      displayName: "Desk",
      target: { kind: "new", to: "ana@x.example", subject: "Hello", account: "desk", from: "me@desk.example" },
      body: "Hi Ana\n\nDesk",
      signed: { wroteTo: null, brand: "Desk", brandReason: "test", signature: "signed" },
    });
    expect(r).toMatchObject({ replyTo: 0, account: "desk", fromReason: null, clientWroteTo: null, brand: "Desk", signature: "signed" });
    expect(r.replaced).toEqual([]);
  });

  it("an unsigned write carries no signing fields", async () => {
    const r = await writeFirstMailDraft({ writer: new FakeDraftWriter(), mail: { accounts: ["desk"], sender: null }, displayName: null, target: { kind: "new", to: "ana@x.example", subject: "Hi", account: "desk", from: null }, body: "Hi" });
    expect(r).not.toHaveProperty("signature");
  });
});

describe("personBrand", () => {
  const two = [brand("One"), brand("Two")];
  it("takes Mail's headers first, then the one recorded brand, then the owner's choice", () => {
    expect(personBrand(two, { fromHeaders: { brand: "Two", wroteTo: "hi@two.example", via: "address", reason: "h" }, recorded: ["One"], requested: null })).toMatchObject({ ok: true, brand: "Two", wroteTo: "hi@two.example" });
    expect(personBrand(two, { fromHeaders: null, recorded: ["One"], requested: null })).toMatchObject({ ok: true, brand: "One" });
    expect(personBrand(two, { fromHeaders: null, recorded: [], requested: "two" })).toMatchObject({ ok: true, brand: "Two" });
  });

  it("refuses an unknown choice, a choice against the headers, and no brand among several", () => {
    expect(personBrand(two, { fromHeaders: null, recorded: [], requested: "Three" })).toMatchObject({ ok: false });
    expect(personBrand(two, { fromHeaders: { brand: "One", wroteTo: null, via: "address", reason: "h" }, recorded: [], requested: "Two" })).toMatchObject({ ok: false, why: expect.stringMatching(/identifies this conversation as One/) });
    expect(personBrand(two, { fromHeaders: null, recorded: ["One", "Two"], requested: null })).toEqual({ ok: false, why: "Choose a brand before saving this Mail draft." });
  });

  it("a project with one brand signs under it without a choice", () => {
    expect(personBrand([brand("Solo")], { fromHeaders: null, recorded: [], requested: null })).toMatchObject({ ok: true, brand: "Solo" });
  });
});

describe("signAsPerson", () => {
  it("names the missing context when there is no resolution", () => {
    const s = signAsPerson({ signoff: "", brands: [], languages: ["en"] }, null, "no context")("Hi");
    expect(s).toMatchObject({ brand: null, wroteTo: null, brandReason: "no context" });
  });
});
