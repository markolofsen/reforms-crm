import { describe, expect, it } from "vitest";
import { createImapHistory } from "../../src/imap/history";
import { buildEml } from "../../src/imap/fake";
import { account, ANNA, ME, server } from "./helpers";

const make = (s = server(), over: Partial<Parameters<typeof createImapHistory>[0]> = {}) =>
  createImapHistory({ accounts: () => [account()], connect: s.connect, ...over });

describe("ImapHistory.page", () => {
  it("lists in and out, newest first, deduplicated, with exact address matching, skipping Drafts and Trash", async () => {
    const page = await make().page({ address: ANNA });
    expect(page.entries.map((e) => e.id)).toEqual(["<a2@x>", "<s2@x>", "<s1@x>", "<a1@x>"]);
    expect(page.entries.map((e) => e.direction)).toEqual(["in", "out", "out", "in"]);
    expect(page.entries.map((e) => e.mailbox)).toEqual(["INBOX", "Sent", "Sent", "INBOX"]);
    expect(page.total).toBe(4);
    expect(page.nextCursor).toBeUndefined();
    const a1 = page.entries[3]!;
    expect(a1).toMatchObject({ from: ANNA, to: [ME], subject: "Viewing next week", attachmentCount: 1, date: "2026-11-01T09:00:00.000Z" });
    expect(page.entries[0]).toMatchObject({ cc: ["bob@example.test"] });
  });

  it("is case-insensitive on the address and rejects shapes that are not one address", async () => {
    const h = make();
    expect((await h.page({ address: "  ANNA@Example.Test " })).total).toBe(4);
    for (const bad of ["", "anna", "a b@x.test", "Anna <anna@example.test>", "a@x.test, b@x.test", 'a"@x.test']) {
      await expect(h.page({ address: bad })).rejects.toMatchObject({ code: "bad_address" });
    }
  });

  it("pages with an opaque cursor, once each message, in a stable order", async () => {
    const h = make();
    const p1 = await h.page({ address: ANNA, limit: 3 });
    expect(p1.entries.map((e) => e.id)).toEqual(["<a2@x>", "<s2@x>", "<s1@x>"]);
    expect(p1.total).toBe(4);
    const p2 = await h.page({ address: ANNA, limit: 3, cursor: p1.nextCursor });
    expect(p2.entries.map((e) => e.id)).toEqual(["<a1@x>"]);
    expect(p2.nextCursor).toBeUndefined();
    await expect(h.page({ address: ANNA, cursor: "garbage" })).rejects.toMatchObject({ code: "bad_cursor" });
    await expect(h.page({ address: ANNA, cursor: Buffer.from("{}").toString("base64url") })).rejects.toMatchObject({ code: "bad_cursor" });
  });

  it("filters by since (inclusive) and direction, and counts after filtering", async () => {
    const h = make();
    expect((await h.page({ address: ANNA, since: "2026-11-04T09:00:00Z" })).entries.map((e) => e.id)).toEqual(["<a2@x>", "<s2@x>"]);
    const out = await h.page({ address: ANNA, direction: "out" });
    expect(out.entries.map((e) => e.id)).toEqual(["<s2@x>", "<s1@x>"]);
    expect(out.total).toBe(2);
  });

  it("lists one message once when it sits in two mailboxes, and keeps the first copy's mailbox", async () => {
    const dup = buildEml({ from: ANNA, to: ME, subject: "Viewing next week", messageId: "<a1@x>", date: "2026-11-01T09:00:00Z" });
    const s = server({ inbox: [] });
    s.boxes.Google!.Archive = { messages: [dup] };
    const page = await make(s).page({ address: ANNA });
    expect(page.entries.filter((e) => e.id === "<a1@x>")).toHaveLength(1);
    expect(page.entries.find((e) => e.id === "<a1@x>")!.mailbox).toBe("INBOX");
  });

  it("reads only the mailboxes the account lists, and Gmail's All Mail alone", async () => {
    const s = server();
    await make(s, { accounts: () => [account({ mailboxes: ["Sent"] })] }).page({ address: ANNA });
    expect(s.ops.filter((o) => o.includes(":search:")).map((o) => o.split(":")[2])).toEqual(["Sent"]);

    const g = server();
    g.boxes.Google!["[Gmail]/All Mail"] = { specialUse: "\\All", messages: [buildEml({ from: ANNA, to: ME, subject: "x", messageId: "<g1@x>", date: "2026-11-08T09:00:00Z" })] };
    const page = await make(g, { accounts: () => [account({ host: "imap.gmail.com" })] }).page({ address: ANNA });
    expect(page.entries.map((e) => e.id)).toEqual(["<g1@x>"]);
  });

  it("only ever issues read calls", async () => {
    const s = server();
    const h = make(s);
    await h.page({ address: ANNA });
    await h.source("<a1@x>");
    const kinds = new Set(s.ops.map((o) => o.split(":")[1]));
    expect([...kinds].every((k) => ["list", "search", "headers", "source", "close"].includes(k!))).toBe(true);
  });

  it("reuses the header list between pages (one read), and reads again after the cache time", async () => {
    const s = server();
    let t = 0;
    const h = make(s, { now: () => t, cacheMs: 1000 });
    await h.page({ address: ANNA, limit: 1 });
    const first = s.connects.length;
    await h.page({ address: ANNA, limit: 1 });
    expect(s.connects.length).toBe(first);
    t = 5000;
    await h.page({ address: ANNA, limit: 1 });
    expect(s.connects.length).toBe(first * 2);
  });

  it("enforces the allow-list in page and in source", async () => {
    const h = make(server(), { allow: (a) => a === ANNA });
    await expect(h.page({ address: "bob@example.test" })).rejects.toMatchObject({ code: "not_allowed" });
    expect((await h.page({ address: ANNA })).total).toBe(4);
    expect(await h.source("<b1@x>")).toBeNull(); // a mail with bob only
    expect(await h.source("<a1@x>")).not.toBeNull();
  });

  it("is unavailable when no account is configured or one cannot be read, and never repeats the server's text", async () => {
    await expect(make(server(), { accounts: () => [] }).page({ address: ANNA })).rejects.toMatchObject({ code: "unavailable" });
    const s = server();
    s.refuse.set("Google", "AUTHENTICATIONFAILED for me@example.test password hunter2-secret-pass");
    const err = await make(s).page({ address: ANNA }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect((err as Error).message).not.toContain("hunter2");
    expect((err as Error).message).toContain("sign-in refused");
  });

  it("merges two accounts and marks own addresses from either", async () => {
    const s = server();
    s.boxes.Work = { INBOX: { messages: [buildEml({ from: "work@example.test", to: ANNA, subject: "From work", messageId: "<w1@x>", date: "2026-11-09T09:00:00Z" })] } };
    const h = createImapHistory({ accounts: () => [account(), account({ name: "Work", user: "work@example.test", addresses: ["work@example.test"] })], connect: s.connect });
    const page = await h.page({ address: ANNA });
    expect(page.entries[0]).toMatchObject({ id: "<w1@x>", direction: "out" });
    expect(page.total).toBe(5);
  });

  it("returns a message's raw source; unknown or malformed ids give null", async () => {
    const h = make();
    const raw = await h.source("<a2@x>");
    expect(raw).not.toBeNull();
    expect(Buffer.from(raw as Uint8Array).toString("utf8")).toContain("Hello.");
    expect(await h.source("<nope@x>")).toBeNull();
    expect(await h.source("a2@x")).toBeNull();
    expect(await h.source('<a" b@x>')).toBeNull();
  });

  it("gives a message without a Message-Id a stable synthetic id and no source", async () => {
    const s = server({ inbox: [buildEml({ from: ANNA, to: ME, subject: "No id", messageId: null, date: "2026-11-09T09:00:00Z" })] });
    const a = (await make(s).page({ address: ANNA })).entries[0]!;
    const b = (await make(s).page({ address: ANNA })).entries[0]!;
    expect(a.id).toMatch(/^<no-id-[0-9a-f]{24}@hub\.invalid>$/);
    expect(a.id).toBe(b.id);
    expect(await make(s).source(a.id)).toBeNull();
  });

  it("a 250-message history pages through without repeats or gaps", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      buildEml({ from: ANNA, to: ME, subject: `m${i}`, messageId: `<bulk${i}@x>`, date: new Date(Date.UTC(2026, 5, 1) + i * 60_000).toISOString() }),
    );
    const h = make(server({ inbox: many }));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await h.page({ address: ANNA, limit: 100, cursor });
      seen.push(...p.entries.map((e) => e.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(254);
    expect(new Set(seen).size).toBe(254);
  });
});
