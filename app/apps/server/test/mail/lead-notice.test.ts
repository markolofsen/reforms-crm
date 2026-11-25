import { describe, expect, it } from "vitest";
import { noticeKeyOf, noticeKeyOfText } from "../../src/mail/lead-notice";

// P145 K5 (verdict 12): a lead notice names its project by the `X-Project-Key` header or the fixed first body line. Only a sender
// on leads.notice_senders is believed; a stranger's header or line names nothing.
const brand = (name: string) => ({ name, receivesAt: [], signature: [], answered: "", by: "owner" as const });
const config = { brands: [brand("Shop One"), brand("Other Site")], leads: { noticeSenders: ["robot@mail.example.test"] } };
const text = (body: string) => async () => body;
const never = async (): Promise<string | null> => {
  throw new Error("the body must not be read");
};

describe("the project key of a lead notice", () => {
  it("takes the header first, matched to the brand row by key, without reading the body", async () => {
    expect(await noticeKeyOf({ email: "Robot@mail.example.test", projectKey: "shop-one" }, config, never)).toEqual({ key: "shop-one", brand: "Shop One", via: "header" });
  });

  it("reads the body line when a forward dropped the header", async () => {
    expect(await noticeKeyOf({ email: "robot@mail.example.test", projectKey: null }, config, text("Project key: other-site\n\nNew lead: Ann"))).toEqual({ key: "other-site", brand: "Other Site", via: "body" });
  });

  it("a key with no brand row is kept without a brand (a project need not be a brand)", async () => {
    expect(await noticeKeyOf({ email: "robot@mail.example.test", projectKey: "a-development" }, config, never)).toEqual({ key: "a-development", brand: null, via: "header" });
  });

  it("a sender off notice_senders names nothing, whatever it sets", async () => {
    expect(await noticeKeyOf({ email: "anyone@example.test", projectKey: "shop-one" }, config, text("Project key: shop-one"))).toEqual({ key: null, brand: null, via: "none" });
  });

  it("the line counts only near the top, alone on its line", () => {
    expect(noticeKeyOfText("Project key: shop-one")).toBe("shop-one");
    expect(noticeKeyOfText("Hello\nthe Project key: shop-one is mine")).toBeNull();
    expect(noticeKeyOfText(`${"line\n".repeat(20)}Project key: shop-one`)).toBeNull();
  });
});
