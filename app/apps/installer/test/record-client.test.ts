import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import { recordClient } from "../src/record-client";
import { recordDraft } from "../src/record-draft";

let dir: string;
let dbPath: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "rc-")); dbPath = path.join(dir, "app.db"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const send = (p: object, project = "acme") => recordClient({ project, payload: JSON.stringify(p), dbPath });
const ID = "0123456789abcdef0123456789abcdef";

async function rows(filter: "all" | "owed" = "all") {
  const h = openDb(dbPath);
  try { return await createRepos(h.db).inbox.list("acme", filter); } finally { h.close(); }
}

describe("hub record-client", () => {
  it("records a skipped client with a lead page and stores no mail text", async () => {
    const r = await send({ email: "a@x.example", name: "Ann", action: "skipped", reason: "newsletter", notion: { kind: "lead", pageId: ID } });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, created: true });
    expect(await rows()).toMatchObject([{ email: "a@x.example", action: "skipped", notionKind: "lead", notionPageId: ID, owed: false }]);
  });

  it("an escalated client is owed an answer", async () => {
    await send({ email: "b@x.example", action: "escalated", reason: "legal", notion: { kind: "none" } });
    expect((await rows("owed")).map((r) => r.email)).toEqual(["b@x.example"]);
  });

  it("refuses a body, an unknown key, an unknown action and a page without an id", async () => {
    for (const p of [
      { email: "a@x.example", action: "skipped", body: "hello" },
      { email: "a@x.example", action: "sent" },
      { email: "a@x.example", action: "skipped", notion: { kind: "client" } },
      { email: "a@x.example", action: "skipped", notion: { kind: "none", pageId: ID } },
      { email: "a@x.example", action: "skipped", notion: { kind: "client", pageId: "short" } },
    ]) expect((await send(p)).code).toBe(2);
    expect(await rows()).toEqual([]);
  });

  it("record-draft states the notion kind and lists the drafted client in the inbox", async () => {
    const r = await recordDraft({ project: "acme", dbPath, payload: JSON.stringify({ email: "c@x.example", name: "Cy", subject: "Re", mailRef: "<c@x>", notion: { kind: "client", url: "https://www.notion.so/Cy-" + ID } }) });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.line).notice).toBeUndefined();
    expect(await rows()).toMatchObject([{ email: "c@x.example", action: "drafted", notionKind: "client", owed: false }]);
    const noted = await recordDraft({ project: "acme", dbPath, payload: JSON.stringify({ email: "d@x.example", subject: "Re", mailRef: "<d@x>" }) });
    expect(JSON.parse(noted.line).notice).toMatch(/notion not stated/);
  });

  it("normalises a dashed page id", async () => {
    await send({ email: "a@x.example", action: "skipped", notion: { kind: "client", pageId: "01234567-89ab-cdef-0123-456789abcdef" } });
    expect((await rows())[0]?.notionPageId).toBe(ID);
  });
});

describe("record-draft stores what the draft was based on", () => {
  it("a complete context lands as basedOn with its own evidence level; none lands as missing and red", async () => {
    const ctx = { batchKey: "k1", thread: { firstContact: false, found: 1, read: 1, readIds: [7], cited: [7], newest: "2026-11-10", rows: [{ date: "2026-11-10", who: "Cy", subject: "Terms", excerpt: "Can you confirm the terms?" }] }, profile: { read: true, state: "filled", editedAt: "2026-11-01" }, facts: { queries: 1, used: ["k-1"], missing: [] }, anchors: ["asked to confirm the terms of the second unit"], personalization: "Cy asked about the terms of the second unit in Lisbon, not the first." };
    await recordDraft({ project: "acme", dbPath, payload: JSON.stringify({ email: "cy@x.example", name: "Cy", subject: "Re", mailRef: "<cy@x>", notion: { kind: "client", pageId: ID }, lastContactAt: "2026-11-10T09:00:00Z", repliesOwed: true, context: ctx }) });
    await recordDraft({ project: "acme", dbPath, payload: JSON.stringify({ email: "no@x.example", name: "No", subject: "Re", mailRef: "<no@x>" }) });
    const h = openDb(dbPath);
    try {
      const all = await createRepos(h.db).clients.review("acme", "all");
      const by = Object.fromEntries(all.map((d) => [d.client.email, d]));
      expect(by["cy@x.example"]?.basedOn).toMatchObject({ level: "ok", context: { thread: { read: 1, rows: [{ who: "Cy" }] } } });
      expect(by["no@x.example"]?.basedOn).toMatchObject({ level: "missing" });
      expect(by["no@x.example"]?.safetyResults.some((r) => r.kind === "no_thread_read" && r.level === "red")).toBe(true);
      expect(by["no@x.example"]?.blocked).toBe(true);
      expect(by["cy@x.example"]?.body).toBe("");
    } finally { h.close(); }
  });

  it("records a call with a free-text phone, and refuses an unknown kind and a body", async () => {
    const r = await send({ email: "d@x.example", name: "Di", action: "escalated", kind: "call", phone: "ask at the front desk", repliesOwed: false, notion: { kind: "none" } });
    expect(r.code).toBe(0);
    const h = openDb(dbPath);
    try { expect(await createRepos(h.db).inbox.notByEmail("acme", "call")).toMatchObject([{ email: "d@x.example", kind: "call", phone: "ask at the front desk" }]); } finally { h.close(); }
    expect((await send({ email: "e@x.example", action: "skipped", kind: "send_it", notion: { kind: "none" } })).code).toBe(2);
    expect((await send({ email: "e@x.example", action: "skipped", kind: "call", body: "hi", notion: { kind: "none" } })).code).toBe(2);
    expect(await rows("owed")).toEqual([]);
  });
});
