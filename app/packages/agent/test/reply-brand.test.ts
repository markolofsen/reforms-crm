import { describe, expect, it } from "vitest";
import type { Brand } from "@hub/projects/model";
import { replyBrand, threadRefs, type ThreadBrandLookups } from "../src/drafts/sign";

// P147 3m finding C: a follow-up in one brand's thread took the other brand from the shared account's address. A reply's
// brand is the thread's first (our earlier send it names), then a brand's own address the client wrote to, then the lead's.

const brand = (name: string, receivesAt: string[]): Brand => ({ name, receivesAt, signature: [`${name} team`], answered: "", by: "owner" });
const cfg = { mail: { accounts: ["hello@studio.test"], addresses: ["help@gadgets.test"], domains: ["studio.test", "gadgets.test"] }, brands: [brand("Studio", ["hello@studio.test", "studio.test"]), brand("Gadgets", ["help@gadgets.test", "gadgets.test"])] };
const look = (o: Partial<ThreadBrandLookups> = {}): ThreadBrandLookups => ({ bySent: async () => null, leadBrand: async () => null, ...o });
const headers = (to: string, extra = "") => `From: Pat Doe <pat@client.test>\nTo: ${to}\n${extra}`;

describe("replyBrand", () => {
  it("reads In-Reply-To and References, folded lines too", () => {
    expect(threadRefs("References: <A@x>\n <b@x>\nIn-Reply-To: <b@x>")).toEqual(["a@x", "b@x"]);
  });

  it("keeps the thread's brand when the client answers our send to the shared account's address", async () => {
    const r = await replyBrand(headers("hello@studio.test", "In-Reply-To: <sent-1@ref>"), cfg, look({ bySent: async (ref) => (ref === "sent-1@ref" ? { id: 45, brand: "Gadgets", wroteTo: "help@gadgets.test" } : null) }));
    expect(r).toMatchObject({ brand: "Gadgets", wroteTo: "help@gadgets.test" });
  });

  it("the thread wins even over another brand's own address in To", async () => {
    const r = await replyBrand(headers("help@gadgets.test", "References: <sent-2@ref>"), cfg, look({ bySent: async () => ({ id: 7, brand: "Studio", wroteTo: "hello@studio.test" }) }));
    expect(r?.brand).toBe("Studio");
  });

  it("no thread send: a brand's own address decides; the shared account's address gives way to the lead's brand", async () => {
    const lead = look({ leadBrand: async () => "Gadgets" });
    expect((await replyBrand(headers("help@gadgets.test"), cfg, look({ leadBrand: async () => "Studio" })))?.brand).toBe("Gadgets");
    expect((await replyBrand(headers("hello@studio.test"), cfg, lead))?.brand).toBe("Gadgets");
    expect((await replyBrand(headers("hello@studio.test"), cfg, look()))?.brand).toBe("Studio");
    expect(await replyBrand(null, cfg, lead)).toBeNull();
  });
});
