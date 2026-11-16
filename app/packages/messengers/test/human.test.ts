import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as agentApi from "../src/index";
import { createDraft, isConfirmed, listOpenDrafts, type Draft } from "../src/index";
import * as human from "../src/human";
import { allowChat, confirmDraft, copyDraft, humanActor, linkIdentifier, sendConfirmed, unlinkIdentifier } from "../src/human";
import { FakeAdapter, FakeSendingAdapter } from "../src/fake";
import { mintConfirmed } from "../src/confirmed";
import { normalizeIdentifier } from "../src/normalize";
import { setup, type Env } from "./helpers";
import { readFileSync } from "node:fs";

let env: Env;
const owner = humanActor("owner");
beforeEach(async () => {
  env = await setup();
  await allowChat(env.repos, owner, { project: "p", channel: "telegram_bot", chatId: "100" });
});
afterEach(() => env.close());

const draftFor = (text = "Hello Anna", channel: "telegram_bot" | "whatsapp" | "telegram_user" = "telegram_bot", chatId = "100") =>
  createDraft(env.repos, { project: "p", channel, chatId, text, createdBy: "run-1" });

describe("the agent can only make drafts", () => {
  it("createDraft returns a Draft and stores status draft", async () => {
    const d: Draft = await draftFor();
    expect(d).toMatchObject({ state: "draft", chatId: "100", text: "Hello Anna" });
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("draft");
    expect(await listOpenDrafts(env.repos, "p")).toHaveLength(1);
  });

  it("the agent entry exports no approve, send, link or allow function", () => {
    const names = Object.keys(agentApi);
    for (const forbidden of ["confirmDraft", "sendConfirmed", "copyDraft", "linkIdentifier", "unlinkIdentifier", "allowChat", "disallowChat", "humanActor", "mintConfirmed", "discardDraft"]) {
      expect(names).not.toContain(forbidden);
    }
    expect(Object.keys(human)).toEqual(expect.arrayContaining(["confirmDraft", "sendConfirmed", "linkIdentifier", "humanActor"]));
  });

  it("the package exposes only two entries, so mintConfirmed cannot be deep-imported", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string> };
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./human"]);
  });

  it("refuses a chat the owner has not listed", async () => {
    await expect(draftFor("hi", "telegram_bot", "999")).rejects.toMatchObject({ code: "chat_not_allowed" });
  });

  it("refuses empty and oversized text", async () => {
    await expect(draftFor("   ")).rejects.toMatchObject({ code: "bad_text" });
    await expect(draftFor("x".repeat(4097))).rejects.toMatchObject({ code: "bad_text" });
  });

  it("a Draft is not a ConfirmedDraft: types and run time agree", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    // @ts-expect-error a Draft is not accepted where a ConfirmedDraft is required
    await expect(adapter.send(d)).rejects.toThrow("not_confirmed");
    expect(isConfirmed(d)).toBe(false);
    expect(isConfirmed({ ...d, state: "confirmed" })).toBe(false);
    expect(adapter.sent).toHaveLength(0);
  });
});

describe("only a human path confirms and sends", () => {
  it("confirmDraft refuses anything that is not a minted human actor", async () => {
    const d = await draftFor();
    const forged = { name: "agent" } as never;
    await expect(confirmDraft(env.repos, forged, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "not_human" });
    await expect(confirmDraft(env.repos, undefined as never, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "not_human" });
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("draft");
  });

  it("approve then send: a minted ConfirmedDraft reaches the adapter, an outbound row joins the history", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    const c = await confirmDraft(env.repos, owner, { project: "p", draftId: d.id });
    expect(isConfirmed(c)).toBe(true);
    expect(c).toMatchObject({ confirmedBy: "owner", text: "Hello Anna" });
    const receipt = await sendConfirmed({ repos: env.repos, adapter, now: () => new Date("2026-11-14T12:00:00Z") }, owner, { project: "p", draftId: d.id });
    expect(adapter.sent).toHaveLength(1);
    expect(isConfirmed(adapter.sent[0])).toBe(true);
    expect((await env.repos.messengers.getDraft("p", d.id))).toMatchObject({ status: "sent", remoteMessageId: receipt.remoteMessageId });
    const rows = await env.repos.messengers.messagesOf("p", [{ channel: "telegram_bot", chatId: "100" }], { limit: 5 });
    expect(rows[0]).toMatchObject({ direction: "out", text: "Hello Anna" });
  });

  it("refuses to send an unapproved draft, and a second send", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    await expect(sendConfirmed({ repos: env.repos, adapter }, owner, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "not_confirmed" });
    await confirmDraft(env.repos, owner, { project: "p", draftId: d.id });
    await sendConfirmed({ repos: env.repos, adapter }, owner, { project: "p", draftId: d.id });
    await expect(sendConfirmed({ repos: env.repos, adapter }, owner, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "not_confirmed" });
    expect(adapter.sent).toHaveLength(1);
  });

  it("send stops if the chat was taken off the allow-list after approval", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    await confirmDraft(env.repos, owner, { project: "p", draftId: d.id });
    await unlinkIdentifier(env.repos, owner, { project: "p", kind: "telegram", value: "100" });
    await expect(sendConfirmed({ repos: env.repos, adapter }, owner, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "chat_not_allowed" });
    expect(adapter.sent).toHaveLength(0);
  });

  it("a receive-only adapter cannot send", async () => {
    const d = await draftFor();
    await confirmDraft(env.repos, owner, { project: "p", draftId: d.id });
    await expect(sendConfirmed({ repos: env.repos, adapter: new FakeAdapter() }, owner, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "no_send_channel" });
  });

  it("an adapter refuses a hand-built or cast confirmation", async () => {
    const adapter = new FakeSendingAdapter();
    const lookalike = { state: "confirmed", id: 1, project: "p", channel: "telegram_bot", chatId: "100", text: "x", confirmedBy: "agent", confirmedAt: "" };
    await expect(adapter.send(lookalike as never)).rejects.toThrow("not_confirmed");
    await expect(adapter.send(mintConfirmed({ ...lookalike, channel: "telegram_bot" } as never))).resolves.toBeDefined();
  });
});

describe("WhatsApp and user accounts: no send at all", () => {
  it("confirm refuses; copy hands over the text and the link to open", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "whatsapp", value: "+49 151 000 0001" });
    const d = await draftFor("Hallo", "whatsapp", "+491510000001");
    await expect(confirmDraft(env.repos, owner, { project: "p", draftId: d.id })).rejects.toMatchObject({ code: "no_send_channel" });
    const r = await copyDraft(env.repos, owner, { project: "p", draftId: d.id });
    expect(r).toMatchObject({ text: "Hallo", openUrl: "https://wa.me/491510000001" });
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("copied");
  });

  it("a user-account Telegram chat opens by id; copy is refused for a sendable bot channel", async () => {
    await allowChat(env.repos, owner, { project: "p", channel: "telegram_user", chatId: "42" });
    const d = await draftFor("hi", "telegram_user", "42");
    expect((await copyDraft(env.repos, owner, { project: "p", draftId: d.id })).openUrl).toBe("tg://user?id=42");
    const b = await draftFor();
    await expect(copyDraft(env.repos, owner, { project: "p", draftId: b.id })).rejects.toMatchObject({ code: "no_send_channel" });
  });

  it("no adapter shape for these channels carries a send", () => {
    expect("send" in new FakeAdapter("whatsapp")).toBe(false);
  });
});

describe("linking", () => {
  it("requires a human actor", async () => {
    await expect(linkIdentifier(env.repos, { name: "x" } as never, { project: "p", clientId: env.clientId, kind: "email", value: "a@b.test" })).rejects.toMatchObject({ code: "not_human" });
  });

  it("is unique per project, kind and value", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "email", value: "Anna@Example.test" });
    await expect(linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "email", value: "anna@example.test" })).rejects.toMatchObject({ code: "duplicate_identifier" });
  });

  it("unlink removes the link and the allow-list entry", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "telegram", value: "777" });
    expect(await env.repos.messengers.isAllowed("p", "telegram_bot", "777")).toBe(true);
    expect(await unlinkIdentifier(env.repos, owner, { project: "p", kind: "telegram", value: "777" })).toEqual({ removed: true, disallowed: 1 });
    expect(await env.repos.messengers.isAllowed("p", "telegram_bot", "777")).toBe(false);
  });

  it("rejects a channel that does not match the kind", async () => {
    await expect(linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "telegram", value: "5", channel: "whatsapp" })).rejects.toMatchObject({ code: "bad_identifier" });
  });
});

describe("normalizeIdentifier", () => {
  it("gives one spelling per identity", () => {
    expect(normalizeIdentifier("email", " Anna@Example.TEST ")).toBe("anna@example.test");
    expect(normalizeIdentifier("telegram", "-1001234567890")).toBe("-1001234567890");
    expect(normalizeIdentifier("whatsapp", "0049 (151) 000-0001")).toBe("+491510000001");
    expect(normalizeIdentifier("phone", "491510000001")).toBe("+491510000001");
  });
  it("rejects garbage", () => {
    expect(() => normalizeIdentifier("email", "nope")).toThrow("bad_identifier");
    expect(() => normalizeIdentifier("telegram", "@anna")).toThrow("bad_identifier");
    expect(() => normalizeIdentifier("phone", "12")).toThrow("bad_identifier");
  });
});
