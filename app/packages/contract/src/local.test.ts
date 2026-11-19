import { describe, expect, it } from "vitest";
import { desktopHandoffReason, DESKTOP_NOT_OFFERED, entryKey, hrefOf, isEntryPath, LOCAL_ACTION_IDS, LOCAL_ACTIONS, urlRefusal } from "./local";

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
      hrefOf("notion.openPage", { pageId: "0123456789abcdef0123456789abcdef", app: true }),
      hrefOf("notion.openPage", { pageId: "0123456789abcdef0123456789abcdef", app: false }),
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
  it("builds the web and the app address from a page id, dashes and case ignored", () => {
    expect(hrefOf("notion.openPage", { pageId: ID, app: false })).toBe(`https://www.notion.so/${ID}`);
    expect(hrefOf("notion.openPage", { pageId: "01234567-89AB-CDEF-0123-456789ABCDEF", app: true })).toBe(`notion://www.notion.so/${ID}`);
  });
  it("has no link for anything that is not 32 hex digits", () => {
    expect(hrefOf("notion.openPage", { pageId: "abc", app: false })).toBeNull();
    expect(hrefOf("notion.openPage", { pageId: `${ID}0`, app: true })).toBeNull();
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
  it("admits Mail, a Notion page by id and only the admin's own page", () => {
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
