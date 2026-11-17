import { describe, expect, it } from "vitest";
import { sessionOver, type ImapFlowLike } from "../../src/imap/imapflow";

/** A stand-in for ImapFlow that records every call. Anything outside the read set would be missing, so it would throw. */
function fakeClient() {
  const calls: string[] = [];
  const lock = (path: string, opts?: { readOnly?: boolean }) => {
    calls.push(`lock:${path}:readOnly=${opts?.readOnly}`);
    return Promise.resolve({ path, release: () => calls.push(`release:${path}`) });
  };
  const msg = (uid: number) => ({
    uid,
    size: 1234,
    internalDate: new Date("2026-11-01T10:00:00Z"),
    envelope: {
      date: new Date("2026-11-01T09:00:00Z"),
      subject: "Hi",
      messageId: `<m${uid}@x>`,
      inReplyTo: "<p@x>",
      from: [{ name: "A", address: "Anna@Example.test" }],
      to: [{ address: "me@example.test" }],
      cc: [{ address: "Bob@example.test" }],
    },
    headers: Buffer.from("References: <p@x> <q@x>\r\n\r\n"),
    bodyStructure: { childNodes: [{ type: "text/plain" }, { disposition: "attachment" }, { childNodes: [{ disposition: "attachment" }, { disposition: "inline" }] }] },
  });
  const client = {
    list: async () => [
      { path: "INBOX", flags: new Set<string>() },
      { path: "Sent", specialUse: "\\Sent", flags: new Set<string>() },
      { path: "[Gmail]", flags: new Set(["\\Noselect"]) },
    ],
    getMailboxLock: lock,
    search: async (q: unknown, o: unknown) => {
      calls.push(`search:${JSON.stringify(q)}:${JSON.stringify(o)}`);
      return [9, 3];
    },
    fetch: async function* (range: unknown, q: Record<string, unknown>, o: unknown) {
      calls.push(`fetch:${JSON.stringify(range)}:${Object.keys(q).sort().join(",")}:${JSON.stringify(o)}`);
      for (const u of range as number[]) yield msg(u);
    },
    fetchOne: async (id: string, q: Record<string, unknown>, o: unknown) => {
      calls.push(`fetchOne:${id}:${Object.keys(q).join(",")}:${JSON.stringify(o)}`);
      return { uid: 3, source: Buffer.from("raw") };
    },
    logout: async () => void calls.push("logout"),
    close: () => void calls.push("close"),
  };
  return { client: client as unknown as ImapFlowLike, calls };
}

describe("sessionOver (imapflow adapter)", () => {
  it("lists selectable mailboxes with special-use", async () => {
    const { client } = fakeClient();
    expect(await sessionOver(client).list()).toEqual([{ path: "INBOX" }, { path: "Sent", specialUse: "\\Sent" }]);
  });

  it("opens every mailbox read-only (EXAMINE), releases the lock, and searches OR From/To/Cc by UID", async () => {
    const { client, calls } = fakeClient();
    const uids = await sessionOver(client).search("INBOX", { address: "anna@example.test", since: new Date("2026-11-01T00:00:00Z") });
    expect(uids).toEqual([3, 9]);
    expect(calls[0]).toBe("lock:INBOX:readOnly=true");
    expect(calls[1]).toContain('"or":[{"from":"anna@example.test"},{"to":"anna@example.test"},{"cc":"anna@example.test"}]');
    expect(calls[1]).toContain('"uid":true');
    expect(calls.at(-1)).toBe("release:INBOX");
    await sessionOver(client).search("INBOX", { messageId: "<x@y>" });
    expect(calls.join("\n")).toContain('"header":{"message-id":"<x@y>"}');
  });

  it("maps an envelope to a header: bare lower-case addresses, ISO date, references, attachments", async () => {
    const { client, calls } = fakeClient();
    const [h] = await sessionOver(client).headers("INBOX", [3]);
    expect(h).toEqual({
      uid: 3,
      messageId: "<m3@x>",
      inReplyTo: "<p@x>",
      references: ["<p@x>", "<q@x>"],
      date: "2026-11-01T09:00:00.000Z",
      from: "anna@example.test",
      to: ["me@example.test"],
      cc: ["bob@example.test"],
      subject: "Hi",
      size: 1234,
      attachmentCount: 2,
    });
    expect(calls.find((c) => c.startsWith("fetch:"))).toContain("bodyStructure,envelope,headers,internalDate,size,uid");
    expect(await sessionOver(client).headers("INBOX", [])).toEqual([]);
  });

  it("fetches a source by UID and closes by logout", async () => {
    const { client, calls } = fakeClient();
    const s = sessionOver(client);
    expect(new TextDecoder().decode((await s.source("INBOX", 3)) as Uint8Array)).toBe("raw");
    expect(calls).toContain('fetchOne:3:source:{"uid":true}');
    await s.close();
    expect(calls.at(-1)).toBe("logout");
  });

  it("never calls a write method: the client double has none, so any would throw", async () => {
    const { client } = fakeClient();
    const writes = ["append", "messageFlagsAdd", "messageFlagsSet", "messageDelete", "messageMove", "messageCopy", "mailboxCreate", "mailboxDelete", "mailboxRename"];
    for (const w of writes) expect((client as unknown as Record<string, unknown>)[w]).toBeUndefined();
    const s = sessionOver(client);
    await s.list();
    await s.search("INBOX", { address: "a@b.test" });
    await s.headers("INBOX", [1]);
    await s.source("INBOX", 1);
  });
});
