import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as agentApi from "../src/index";
import { createDraft, isConfirmed, listOpenDrafts, type Draft } from "../src/index";
import * as human from "../src/human";
import { knowChat, humanActor, linkIdentifier, moveChatToRecord, undoMoveChat, unlinkIdentifier } from "../src/human";
import { confirmDraft, sendConfirmed } from "../src/send-confirmed";
import { mintAuthorization, textHash } from "../src/authorization";
import { FakeAdapter, FakeSendingAdapter } from "../src/fake";
import { mintConfirmed } from "../src/confirmed";
import { normalizeIdentifier } from "../src/normalize";
import { authorized, setup, type Env } from "./helpers";
import { readFileSync } from "node:fs";

let env: Env;
const owner = humanActor("owner");
beforeEach(async () => {
  env = await setup();
  await knowChat(env.repos, owner, { project: "p", channel: "telegram_bot", chatId: "100" });
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
    for (const forbidden of ["confirmDraft", "sendConfirmed", "linkIdentifier", "unlinkIdentifier", "knowChat", "forgetChat", "addClientEmail", "humanActor", "mintConfirmed", "discardDraft"]) {
      expect(names).not.toContain(forbidden);
    }
    expect(Object.keys(human)).toEqual(expect.arrayContaining(["linkIdentifier", "humanActor"]));
    // P126 D1, P112 S2: neither the approval nor the send is on `./human`; only the door (`./door`) reaches them.
    expect(Object.keys(human)).not.toContain("sendConfirmed");
    expect(Object.keys(human)).not.toContain("confirmDraft");
  });

  it("the package exposes three entries (P126 D1 added the door), none of them mintConfirmed or sendConfirmed", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string> };
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./door", "./human"]);
    const door = await import("../src/door");
    expect(Object.keys(door)).not.toContain("mintConfirmed");
    expect(Object.keys(door)).not.toContain("sendConfirmed");
    for (const internal of ["confirmDraft", "mintAuthorization", "assertAuthorized"]) expect(Object.keys(door)).not.toContain(internal);
  });

  it("refuses a chat the owner has not listed", async () => {
    await expect(draftFor("hi", "telegram_bot", "999")).rejects.toMatchObject({ code: "chat_not_known" });
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

describe("only the door's authorization confirms and sends (P112 S2)", () => {
  it("confirmDraft refuses anything that is not the door's authorization, a HumanActor included", async () => {
    const d = await draftFor();
    const real = await authorized(env.repos, "p", d.id);
    const forged = { ...real } as never;
    await expect(confirmDraft(env.repos, forged, {})).rejects.toMatchObject({ code: "not_authorized" });
    await expect(confirmDraft(env.repos, owner as never, {})).rejects.toThrow();
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("draft");
  });

  it("an authorization is bound to the text: a draft edited after the door judged it is neither confirmed nor sent", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    const auth = await authorized(env.repos, "p", d.id);
    env.handle.db.$client.prepare("update messenger_drafts set text = ? where id = ?").run("Hello Anna, and pay me twice", d.id);
    await expect(confirmDraft(env.repos, auth, {})).rejects.toMatchObject({ code: "not_authorized" });
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("draft");
    // Another draft's authorization does not open this one.
    const other = await draftFor("Other text");
    const wrong = mintAuthorization({ authority: { kind: "owner_click", actor: "admin" }, project: "p", draftId: other.id, channel: "telegram_bot", chatId: "100", account: "test", textHash: textHash("Other text"), policyGeneration: "test" });
    await expect(confirmDraft(env.repos, { ...wrong, draftId: d.id } as never, {})).rejects.toMatchObject({ code: "not_authorized" });
    await expect(sendConfirmed({ repos: env.repos, adapter }, wrong)).rejects.toMatchObject({ code: "not_confirmed" });
    expect(adapter.sent).toHaveLength(0);
  });

  it("approve then send: a minted ConfirmedDraft reaches the adapter, an outbound row joins the history", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    const c = await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    expect(isConfirmed(c)).toBe(true);
    expect(c).toMatchObject({ confirmedBy: "admin", text: "Hello Anna" });
    const receipt = await sendConfirmed({ repos: env.repos, adapter, now: () => new Date("2026-11-14T12:00:00Z") }, await authorized(env.repos, "p", d.id));
    expect(adapter.sent).toHaveLength(1);
    expect(isConfirmed(adapter.sent[0])).toBe(true);
    expect((await env.repos.messengers.getDraft("p", d.id))).toMatchObject({ status: "sent", remoteMessageId: receipt.remoteMessageId });
    const rows = await env.repos.messengers.messagesOf("p", [{ channel: "telegram_bot", chatId: "100" }], { limit: 5 });
    expect(rows[0]).toMatchObject({ direction: "out", text: "Hello Anna" });
  });

  it("refuses to send an unapproved draft, and a second send", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    await expect(sendConfirmed({ repos: env.repos, adapter }, await authorized(env.repos, "p", d.id))).rejects.toMatchObject({ code: "not_confirmed" });
    await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    await sendConfirmed({ repos: env.repos, adapter }, await authorized(env.repos, "p", d.id));
    await expect(sendConfirmed({ repos: env.repos, adapter }, await authorized(env.repos, "p", d.id))).rejects.toMatchObject({ code: "not_confirmed" });
    expect(adapter.sent).toHaveLength(1);
  });

  it("send stops if the chat was forgotten (hidden) after approval", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    const auth = await authorized(env.repos, "p", d.id);
    await confirmDraft(env.repos, auth, {});
    await env.repos.messengers.knowChat("p", "telegram_bot", "200");
    await env.repos.messengers.createDraft({ project: "p", channel: "telegram_bot", chatId: "200", text: "kept", createdBy: "agent" });
    // Decision 0049: forgetting a chat (Hide) deletes its drafts with it (one transaction), so the approved draft is gone, not only blocked.
    await human.forgetChat(env.repos, owner, { project: "p", channel: "telegram_bot", chatId: "100" });
    await expect(sendConfirmed({ repos: env.repos, adapter }, auth)).rejects.toMatchObject({ code: "not_confirmed" });
    expect(await env.repos.messengers.getDraft("p", d.id)).toBeNull();
    expect((await env.repos.messengers.listDrafts("p")).map((x) => x.chatId)).toEqual(["200"]);
    expect(adapter.sent).toHaveLength(0);
  });

  it("send stops if the chat row was taken off the allow-list by hand after approval", async () => {
    const adapter = new FakeSendingAdapter();
    const d = await draftFor();
    await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    env.handle.db.$client.prepare("delete from messenger_chats where chat_id = '100'").run();
    await expect(sendConfirmed({ repos: env.repos, adapter }, await authorized(env.repos, "p", d.id))).rejects.toMatchObject({ code: "chat_not_known" });
    expect(adapter.sent).toHaveLength(0);
  });

  it("a receive-only adapter cannot send", async () => {
    const d = await draftFor();
    await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    await expect(sendConfirmed({ repos: env.repos, adapter: new FakeAdapter() }, await authorized(env.repos, "p", d.id))).rejects.toMatchObject({ code: "no_send_channel" });
  });

  it("an adapter refuses a hand-built or cast confirmation", async () => {
    const adapter = new FakeSendingAdapter();
    const lookalike = { state: "confirmed", id: 1, project: "p", channel: "telegram_bot", chatId: "100", text: "x", confirmedBy: "agent", confirmedAt: "" };
    await expect(adapter.send(lookalike as never)).rejects.toThrow("not_confirmed");
    await expect(adapter.send(mintConfirmed({ ...lookalike, channel: "telegram_bot" } as never))).resolves.toBeDefined();
  });
});

describe("user accounts send through the door (Telegram since P71 M4, WhatsApp since M5)", () => {
  it("confirm takes a WhatsApp and a Telegram user-account draft of a linked chat", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "whatsapp", value: "+49 151 000 0001" });
    const w = await draftFor("Hallo", "whatsapp", "+491510000001");
    await expect(confirmDraft(env.repos, await authorized(env.repos, "p", w.id), {})).resolves.toMatchObject({ channel: "whatsapp", chatId: "+491510000001", text: "Hallo" });
    await knowChat(env.repos, owner, { project: "p", channel: "telegram_user", chatId: "42" });
    const d = await draftFor("hi", "telegram_user", "42");
    await expect(confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {})).resolves.toMatchObject({ channel: "telegram_user", chatId: "42", text: "hi" });
  });

  it("the copy path is gone: no channel is copied by hand", () => {
    expect(Object.keys(human)).not.toContain("copyDraft");
    expect(Object.keys(human)).not.toContain("openChatUrl");
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

  it("unlink removes the link only: the chat stays known, not linked (decision 0049)", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "telegram", value: "777" });
    expect(await env.repos.messengers.isLinked("p", "telegram_bot", "777")).toBe(true);
    expect(await unlinkIdentifier(env.repos, owner, { project: "p", kind: "telegram", value: "777" })).toEqual({ removed: true });
    expect(await env.repos.messengers.isKnown("p", "telegram_bot", "777")).toBe(true);
    expect(await env.repos.messengers.isLinked("p", "telegram_bot", "777")).toBe(false);
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

describe("P102 Change client", () => {
  it("moves a linked chat to another client, sets its open draft aside, refuses the same client or an unlinked chat, and undoes", async () => {
    await linkIdentifier(env.repos, owner, { project: "p", clientId: env.clientId, kind: "whatsapp", value: "+49 151 000 0001" });
    const d = await draftFor("Hi", "whatsapp", "+491510000001");
    const input = { project: "p", channel: "whatsapp" as const, chatId: "+491510000001", client: { pageId: null, email: "new@x.test", name: "New" } };
    const r = await moveChatToRecord(env.repos, owner, input);
    expect(r.fromClientId).toBe(env.clientId);
    expect(r.skippedDraftId).toBe(d.id);
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("discarded");
    await expect(moveChatToRecord(env.repos, owner, input)).rejects.toMatchObject({ code: "bad_identifier" });
    await expect(moveChatToRecord(env.repos, owner, { ...input, chatId: "+491510000009" })).rejects.toMatchObject({ code: "bad_identifier" });
    expect(await undoMoveChat(env.repos, owner, { project: "p", channel: "whatsapp", chatId: "+491510000001", clientId: r.fromClientId, draftId: r.skippedDraftId })).toEqual({ draftRestored: true });
    expect(await env.repos.messengers.clientByIdentifier("p", "whatsapp", "+491510000001")).toBe(env.clientId);
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("draft");
  });
});

describe("P141 C3/C4: a client known only by a chat", () => {
  it("is made from a record without an email, and its email later merges it into the client that has the address", async () => {
    const { id: chatOnly, created } = await human.ensureClient(env.repos, "p", { pageId: "page-q", email: null, name: "Qimma" });
    expect(created).toBe(true);
    expect(await human.ensureClient(env.repos, "p", { pageId: "page-q", email: null, name: "Qimma" })).toEqual({ id: chatOnly, created: false });
    const withMail = await env.repos.clients.create({ project: "p", email: "q@example.test", name: "q@example.test" });
    expect(await human.addClientEmail(env.repos, owner, { project: "p", clientId: chatOnly, email: "Q@Example.test" })).toEqual({ clientId: withMail, merged: true });
    expect((await env.repos.clients.get("p", withMail))?.name).toBe("Qimma");
    // An address nobody has is simply its Email; an Email is never replaced.
    const lone = await env.repos.clients.create({ project: "p", email: null, name: "Lone" });
    expect(await human.addClientEmail(env.repos, owner, { project: "p", clientId: lone, email: "lone@example.test" })).toEqual({ clientId: lone, merged: false });
    await expect(human.addClientEmail(env.repos, owner, { project: "p", clientId: lone, email: "other@example.test" })).rejects.toMatchObject({ code: "wrong_state" });
  });
});
