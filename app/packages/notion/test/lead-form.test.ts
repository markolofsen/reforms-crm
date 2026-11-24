import { describe, expect, it } from "vitest";
import { addressTypo } from "../src/address-typo";
import { channelOf, countryName, detailLines, domainsIn, hostOf, leadFactsOf, leadFormOf } from "../src/lead-form";
import { parseLeadDetail } from "../src/leads";
import type { PageObject } from "../src/types";

// P138 E1: the Details of a carapis lead as django_notion writes them (one `Label: value` line each; enrich adds the hosts).
const DETAILS = [
  "Company website: www.almirsolutions.com",
  "Country: AE",
  "Segment: Dealer",
  "Wanted sources: autoscout24_de, mobile_de",
  "Contact channel: WhatsApp: +971 50 123 4567",
  "Expected volume: Under 10k/month",
  "Consent version: 3",
  "Fleet size: 40",
  "Locale: en",
  "Environment: production",
  "Site: carapis.com",
  "API host: api.carapis.com",
  "UTM source: google",
].join("\n");

describe("a lead's form (P138 E1)", () => {
  it("sorts Details into what they want (known order, then unknown), the channel, the sites and the technical lines", () => {
    const f = leadFormOf({ details: DETAILS, company: "Almir Solutions", message: "We need listings from mobile.de and https://www.autoscout24.com/lst.", form: "lead", pageUrl: "https://carapis.com/contact" });
    expect(f.fields.map((x) => [x.label, x.value])).toEqual([
      ["Company", "Almir Solutions"],
      ["Website", "www.almirsolutions.com"],
      ["Country", "United Arab Emirates"],
      ["Segment", "Dealer"],
      ["Expected volume", "Under 10k/month"],
      ["Fleet size", "40"],
    ]);
    expect(f.fields.find((x) => x.key === "website")?.href).toBe("https://www.almirsolutions.com");
    expect(f.channel).toEqual({ kind: "whatsapp", value: "+971 50 123 4567" });
    expect(f.sites.map((s) => s.name)).toEqual(["autoscout24_de", "mobile_de", "mobile.de", "autoscout24.com"]);
    expect(f.sites.find((s) => s.name === "mobile.de")?.href).toBe("https://mobile.de");
    expect(f.sites[0]?.href).toBeNull();
    expect(f.technical.map((t) => t.label)).toEqual(["Consent version", "Locale", "Environment", "Site", "API host", "UTM source", "Form", "Page URL"]);
    expect(leadFactsOf(f)).toEqual({ site: "almirsolutions.com", country: "United Arab Emirates", segment: "Dealer", volume: "Under 10k/month" });
  });
  it("reads lines: a line without a label continues the one above; a URL is not a label", () => {
    expect(detailLines("Note: first\nsecond part\nhttps://x.test/a\n\nCountry: PT")).toEqual([
      { label: "Note", value: "first second part https://x.test/a" },
      { label: "Country", value: "PT" },
    ]);
    expect(detailLines("")).toEqual([]);
  });
  it("names the channel, the country and the host", () => {
    expect(channelOf("Telegram: @almir")).toEqual({ kind: "telegram", value: "@almir" });
    expect(channelOf("Email: a@b.co")).toEqual({ kind: "email", value: "a@b.co" });
    expect(channelOf("+351 912 000 000")).toEqual({ kind: "phone", value: "+351 912 000 000" });
    expect(channelOf("Signal please")).toEqual({ kind: "other", value: "Signal please" });
    expect(countryName("de")).toBe("Germany");
    expect(countryName("Portugal")).toBe("Portugal");
    expect(hostOf("https://WWW.Example.com/x")).toBe("example.com");
    expect(hostOf("not a site")).toBeNull();
    expect(domainsIn("see mobile.de, mail me at a@b.com")).toEqual(["mobile.de"]);
  });
  it("an empty form has no fields and no facts", () => {
    const f = leadFormOf({ details: "" });
    expect(f).toEqual({ fields: [], channel: null, sites: [], technical: [] });
    expect(leadFactsOf(f)).toEqual({ site: null, country: null, segment: null, volume: null });
  });
  it("the card's read is the first line of Conversation summary; the sheet comes with the page", () => {
    const rt = (s: string) => ({ type: "rich_text", rich_text: [{ plain_text: s }] });
    const page: PageObject = { id: "p1", last_edited_time: "2026-11-24T00:00:00Z", properties: { Name: { type: "title", title: [{ plain_text: "Almir" }] }, Details: rt(DETAILS), "Conversation summary": rt("\nDealer in the UAE: offer the Pro trial\nmore") } };
    const l = parseLeadDetail(page);
    expect(l.read).toBe("Dealer in the UAE: offer the Pro trial");
    expect(l.sheet.channel?.kind).toBe("whatsapp");
    expect(parseLeadDetail({ ...page, properties: { Name: page.properties.Name! } }).read).toBeNull();
  });
});

describe("the address typo check (P138 verdict 4)", () => {
  it("flags a common top-level domain or provider typo and says what was meant", () => {
    expect(addressTypo("info@almirsolutions.vom")).toEqual({ address: "info@almirsolutions.vom", suggestion: "info@almirsolutions.com", domain: "almirsolutions.vom", meant: "almirsolutions.com" });
    expect(addressTypo("Ana@Gmial.com")?.suggestion).toBe("ana@gmail.com");
    expect(addressTypo("x@site.ogr")?.meant).toBe("site.org");
  });
  it("never corrects a real top-level domain or a fine address", () => {
    for (const a of ["a@b.co", "a@b.cm", "a@b.om", "a@example.com", "a@mail.ru", "", null, "no-at", "a@"]) expect(addressTypo(a)).toBeNull();
  });
});
