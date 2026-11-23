import { describe, expect, it } from "vitest";
import { desktopHandoffReason, DESKTOP_NOT_OFFERED, destinationOf, entryKey, hrefOf, isEntryPath, LOCAL_ACTION_IDS, LOCAL_ACTIONS, NO_APPS, notionPageDestination, openLinkOf, phoneDigits, telegramDestination, urlRefusal, whatsappDestination } from "../src/local";

// P61: the registry. The mailLink, composeHref and notionLinks cases moved here from the admin (`test/mail.test.ts`) and
// `@hub/config`, unchanged in their outputs.

describe("the registry", () => {
  it("every action has a schema, a label and a transport", () => {
    for (const id of LOCAL_ACTION_IDS) {
      const a = LOCAL_ACTIONS[id];
      expect(a.label.length, id).toBeGreaterThan(0);
      expect(["href", "server"]).toContain(a.transport);
      expect(typeof a.args.safeParse).toBe("function");
    }
  });
  it("every href builder yields an allowed scheme", () => {
    const hrefs = [
      hrefOf("mail.openMessage", { messageId: "abc@host.example" }),
      hrefOf("mail.openDraft", { messageId: "<d@host.example>" }),
      hrefOf("mail.compose", { to: "a@x.com", cc: null, subject: "Hi" }),
      hrefOf("notion.openPage", { pageId: "0123456789abcdef0123456789abcdef" }),
    ];
    for (const h of hrefs) expect(h && urlRefusal(h)).toBeNull();
  });
  it("the desktop handoff is declared and not offered (owner item 7)", () => {
    expect(LOCAL_ACTIONS["agent.openInDesktop"]).toMatchObject({ transport: "server", offered: false, refusal: DESKTOP_NOT_OFFERED });
    expect(desktopHandoffReason("claude")).toBe(DESKTOP_NOT_OFFERED);
    expect(desktopHandoffReason("codex")).toMatch(/^Codex: /);
    expect(desktopHandoffReason("shell")).toBeNull();
  });
});

describe("mail.openMessage (was mailLink)", () => {
  const link = (m: string | null) => (m === null ? null : hrefOf("mail.openMessage", { messageId: m }));
  it("builds a message:// link from a Message-ID with or without brackets", () => {
    expect(link("<abc@host.example>")).toBe("message://%3Cabc%40host.example%3E");
    expect(link("abc@host.example")).toBe("message://%3Cabc%40host.example%3E");
  });
  it("has no link for anything else", () => {
    expect(link(null)).toBeNull();
    expect(link("draft-12")).toBeNull();
    expect(link("two words@host")).toBeNull();
  });
});

describe("mail.compose (was composeHref)", () => {
  const base = { to: "a@x.com", cc: null, subject: "Hello" };
  it("addresses one recipient", () => {
    expect(hrefOf("mail.compose", base)).toBe("mailto:a%40x.com?subject=Hello");
  });
  it("separates several recipients with a literal comma, each encoded alone", () => {
    expect(hrefOf("mail.compose", { ...base, to: "a@x.com, b@y.com;c@z.org" })).toBe("mailto:a%40x.com,b%40y.com,c%40z.org?subject=Hello");
  });
  it("carries Cc the same way", () => {
    expect(hrefOf("mail.compose", { ...base, cc: "d@x.com, e@y.com" })).toBe("mailto:a%40x.com?subject=Hello&cc=d%40x.com,e%40y.com");
    expect(hrefOf("mail.compose", { ...base, cc: "  " })).toBe("mailto:a%40x.com?subject=Hello");
  });
  it("encodes a subject with &, + and spaces", () => {
    expect(hrefOf("mail.compose", { ...base, subject: "Terms & fees +10%" })).toBe("mailto:a%40x.com?subject=Terms%20%26%20fees%20%2B10%25");
  });
});

describe("notion.openPage (was notionLinks)", () => {
  const ID = "0123456789abcdef0123456789abcdef";
  it("builds the web page from a page id, dashes and case ignored; the app is chosen at render (P131), not by the caller", () => {
    expect(hrefOf("notion.openPage", { pageId: ID })).toBe(`https://www.notion.so/${ID}`);
    expect(hrefOf("notion.openPage", { pageId: "01234567-89AB-CDEF-0123-456789ABCDEF" })).toBe(`https://www.notion.so/${ID}`);
  });
  it("has no link for anything that is not 32 hex digits", () => {
    expect(hrefOf("notion.openPage", { pageId: "abc" })).toBeNull();
    expect(hrefOf("notion.openPage", { pageId: `${ID}0` })).toBeNull();
  });
});

describe("the destinations table (P131 O1)", () => {
  const ID = "0123456789abcdef0123456789abcdef";
  const DASHED = "01234567-89ab-cdef-0123-456789abcdef";
  it.each([
    [`https://www.notion.so/${ID}`, `notion://www.notion.so/${ID}`],
    [`https://www.notion.so/Acme-client-${ID}`, `notion://www.notion.so/Acme-client-${ID}`],
    [`https://www.notion.so/${DASHED}`, `notion://www.notion.so/${DASHED}`],
    [`https://www.notion.so/team/${ID}?v=fedcba9876543210fedcba9876543210`, `notion://www.notion.so/team/${ID}?v=fedcba9876543210fedcba9876543210`],
    [`https://notion.so/${ID}?pvs=4`, `notion://notion.so/${ID}?pvs=4`],
    [`https://acme.notion.site/Price-list-${ID}`, `notion://acme.notion.site/Price-list-${ID}`],
    [`https://www.notion.com/${ID}`, `notion://www.notion.com/${ID}`],
    [`https://app.notion.com/p/${ID}`, `notion://app.notion.com/p/${ID}`],
  ])("a Notion page %s opens in the app as %s, both forms admitted", (web, app) => {
    expect(destinationOf(web)).toEqual({ kind: "notion", web, app });
    expect(destinationOf(app)).toEqual({ kind: "notion", web, app });
    expect(urlRefusal(web)).toBeNull();
    expect(urlRefusal(app)).toBeNull();
  });
  it("a Notion address with no page id, another host, an unknown query or a traversal is not a destination", () => {
    for (const u of ["https://www.notion.so/login", `https://evil.example/${ID}`, `https://notion.so.evil.example/${ID}`, `https://www.notion.so/${ID}?redirect=https://x`, `https://www.notion.so/../${ID}`, `http://www.notion.so/${ID}`]) {
      expect(destinationOf(u), u).toBeNull();
      expect(urlRefusal(u), u).not.toBeNull();
    }
  });
  it("Telegram: a username opens t.me or tg://resolve?domain=; a phone only the app; nothing prefilled", () => {
    expect(telegramDestination({ username: "@anna_k" })).toEqual({ kind: "telegram", web: "https://t.me/anna_k", app: "tg://resolve?domain=anna_k" });
    expect(destinationOf("https://t.me/anna_k")).toEqual(telegramDestination({ username: "anna_k" }));
    expect(telegramDestination({ phone: "+351 912 345 678" })).toEqual({ kind: "telegram", web: null, app: "tg://resolve?phone=351912345678" });
    expect(telegramDestination({ username: "x", phone: null })).toBeNull();
    for (const u of ["https://t.me/anna_k", "tg://resolve?domain=anna_k", "tg://resolve?phone=351912345678"]) expect(urlRefusal(u), u).toBeNull();
    for (const u of ["tg://resolve?domain=anna_k&text=hi", "https://t.me/anna_k?text=hi", "tg://msg?text=hi"]) expect(urlRefusal(u), u).not.toBeNull();
  });
  it("WhatsApp: a number opens wa.me or whatsapp://send?phone=, digits with the country code; text is never prefilled", () => {
    expect(whatsappDestination("+351 (912) 345-678")).toEqual({ kind: "whatsapp", web: "https://wa.me/351912345678", app: "whatsapp://send?phone=351912345678" });
    expect(whatsappDestination("12345")).toBeNull();
    expect(whatsappDestination("120363025@g.us")).toBeNull();
    for (const u of ["https://wa.me/351912345678", "whatsapp://send?phone=351912345678"]) expect(urlRefusal(u), u).toBeNull();
    for (const u of ["whatsapp://send?phone=351912345678&text=hi", "https://wa.me/351912345678?text=hi"]) expect(urlRefusal(u), u).not.toBeNull();
  });
  it("phoneDigits keeps 7 to 15 digits and refuses letters", () => {
    expect(phoneDigits("+1 (555) 010-9999")).toBe("15550109999");
    expect(phoneDigits("call me")).toBeNull();
    expect(phoneDigits("+1234567890123456")).toBeNull();
  });
  it("openLinkOf: the app's link in the same tab when the app is here, else the web page in a new tab, and says which", () => {
    const d = notionPageDestination(ID);
    expect(openLinkOf(d, { ...NO_APPS, notion: true }, true)).toEqual({ href: `notion://www.notion.so/${ID}`, newTab: false, inApp: true, label: "Open in Notion" });
    expect(openLinkOf(d, NO_APPS, true)).toEqual({ href: `https://www.notion.so/${ID}`, newTab: true, inApp: false, label: "Open in browser" });
    // The probe said yes, but this server does not open locally (not macOS): the web page.
    expect(openLinkOf(d, { ...NO_APPS, notion: true }, false)?.inApp).toBe(false);
    // A Telegram phone has no web form: no link without the app.
    expect(openLinkOf(telegramDestination({ phone: "+351912345678" }), NO_APPS, true)).toBeNull();
    expect(openLinkOf(telegramDestination({ phone: "+351912345678" }), { ...NO_APPS, telegram: true }, true)?.href).toBe("tg://resolve?phone=351912345678");
    expect(openLinkOf(whatsappDestination("351912345678"), NO_APPS, true)).toEqual({ href: "https://wa.me/351912345678", newTab: true, inApp: false, label: "Open in WhatsApp (web)" });
    expect(openLinkOf(null, NO_APPS, true)).toBeNull();
  });
});

describe("the key grammar", () => {
  const parse = (action: "finder.open" | "finder.reveal" | "file.open", key: string) => LOCAL_ACTIONS[action].args.safeParse({ project: "acme-travel", key }).success;
  it("accepts the declared keys", () => {
    for (const k of ["project", "knowledge", "workflows"]) expect(parse("finder.open", k), k).toBe(true);
    for (const k of ["project.md", entryKey("knowledge/files/how-can-i-pay-41806f30.md"), "log:2026-11-19"]) expect(parse("file.open", k), k).toBe(true);
    expect(parse("finder.reveal", "project.md")).toBe(true);
    expect(parse("finder.reveal", "knowledge")).toBe(true);
  });
  it("refuses .., an absolute path, a ~ path and an unknown key", () => {
    for (const k of ["knowledge:knowledge/../../config/config.json", "knowledge:/etc/passwd", "knowledge:~/x.md", "../../config/config.json", "/etc", "~", "dumps", "knowledge:files/x.md", "log:yesterday", "knowledge:knowledge//x.md"]) {
      expect(parse("file.open", k), k).toBe(false);
      expect(parse("finder.reveal", k), k).toBe(false);
    }
    expect(parse("finder.open", "project.md")).toBe(false);
    expect(parse("file.open", "knowledge")).toBe(false);
  });
  it("refuses an extra field and a bad slug", () => {
    expect(LOCAL_ACTIONS["file.open"].args.safeParse({ project: "acme-travel", key: "project.md", path: "/etc" }).success).toBe(false);
    expect(LOCAL_ACTIONS["file.open"].args.safeParse({ project: "../x", key: "project.md" }).success).toBe(false);
  });
  it("an entry path is under knowledge/ with no empty, . or .. segment", () => {
    expect(isEntryPath("knowledge/notion/a b.md")).toBe(true);
    expect(isEntryPath("knowledge")).toBe(false);
    expect(isEntryPath("knowledge/./x.md")).toBe(false);
    expect(isEntryPath("knowledge/a\\..\\b")).toBe(false);
  });
});

describe("the URL allowlist", () => {
  it("admits Mail, the destinations and only the admin's own page", () => {
    expect(urlRefusal("message://%3Ca%40b%3E")).toBeNull();
    expect(urlRefusal("http://127.0.0.1:5173", { adminPort: 5173 })).toBeNull();
    expect(urlRefusal("http://localhost:5173/", { adminPort: 5173 })).toBeNull();
  });
  it("refuses everything else, naming the scheme", () => {
    expect(urlRefusal("http://127.0.0.1:4317/", { adminPort: 5173 })).toMatch(/http scheme/);
    expect(urlRefusal("https://evil.example/")).toMatch(/https scheme/);
    expect(urlRefusal("https://www.notion.so/login")).toMatch(/https scheme/);
    expect(urlRefusal("file:///etc/passwd")).toMatch(/file scheme/);
    expect(urlRefusal("claude://resume?session=x")).toMatch(/claude scheme/);
    expect(urlRefusal("javascript:alert(1)")).toMatch(/javascript scheme/);
  });
});
