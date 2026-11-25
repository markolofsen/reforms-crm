import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureOps } from "@hub/log/ops";
import { applyMessenger, assessMessenger, type MessengerDoorDeps, type MessengerProjectPolicy } from "../src/door";
import { FakeSendingAdapter } from "../src/fake";
import { setup, type Env } from "./helpers";

// P112 S2: the messenger door's stages on a fake bot adapter (no network). The project's lifecycle and its policy generation
// are read again right before the row; every authority is stated by the caller; an owner word is spent once; each outcome is
// one ops line. The HTTP routes over this door are `apps/server/test/messenger-send.test.ts` and `agent-send.test.ts`.

let env: Env;
let adapter: FakeSendingAdapter;
const NOW = new Date("2026-11-24T12:00:00.000Z");
const open: MessengerProjectPolicy = { lifecycle: null, generation: "g1", recipients: () => null };
const depsWith = (policy: (project: string) => MessengerProjectPolicy): MessengerDoorDeps => ({ repos: env.repos, policy, senders: { sender: () => adapter }, now: () => NOW });
const CLICK = { kind: "owner_click", actor: "admin" } as const;

beforeEach(async () => {
  env = await setup();
  adapter = new FakeSendingAdapter();
  await env.repos.messengers.knowChat("p", "telegram_bot", "100", { title: "Anna" });
  await env.repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "bot", chatId: "100", remoteMessageId: "1", direction: "in", kind: "text", text: "Is the 28th on?", sentAt: new Date(NOW.getTime() - 3_600_000).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
});
afterEach(() => env.close());

const draft = async (text = "Yes, the 28th stands.") => (await env.repos.messengers.createDraft({ project: "p", channel: "telegram_bot", chatId: "100", text, createdBy: "agent" })).id;
const confirm = { chatId: "100", text: "Yes, the 28th stands." };

describe("the messenger door's stages (P112 S2)", () => {
  it("an owner's click passes every stage once: one row with its actor, one send, one ops line", async () => {
    const id = await draft();
    const cap = captureOps();
    const r = await applyMessenger(depsWith(() => open), "p", id, confirm, CLICK).finally(() => cap.stop());
    expect(r).toEqual({ sendId: expect.any(Number) });
    expect(adapter.sent).toHaveLength(1);
    expect(await env.repos.sends.list("p")).toEqual([expect.objectContaining({ actor: "admin", status: "sent", messengerDraftId: id })]);
    expect(cap.lines.filter((l) => l.source === "send").map((l) => [l.level, l.message])).toEqual([["info", "messenger door: sent"]]);
  });

  it("P141 U4: a known chat no client is linked to takes the owner's own reply; without an inbound message it is first contact", async () => {
    expect(await env.repos.messengers.isLinked("p", "telegram_bot", "100")).toBe(false);
    const id = await draft();
    expect((await assessMessenger(depsWith(() => open), "p", id))?.reasons).toEqual([]);
    await env.repos.messengers.knowChat("p", "telegram_bot", "200", { title: "Quiet" });
    const quiet = (await env.repos.messengers.createDraft({ project: "p", channel: "telegram_bot", chatId: "200", text: "Hello", createdBy: "owner" })).id;
    expect((await assessMessenger(depsWith(() => open), "p", quiet))?.reasons).toContain("nobody wrote in this chat yet: the hub never makes the first contact");
  });

  it("a placeholder left in the text is refused at the assessment and nothing goes out, whoever sends (as the mail door)", async () => {
    const id = await draft("The price is [Owner: confirm the tier] a month.");
    expect((await assessMessenger(depsWith(() => open), "p", id))?.reasons).toContain("a placeholder is left in the text: [Owner: confirm the tier]");
    const r = await applyMessenger(depsWith(() => open), "p", id, { chatId: "100", text: "The price is [Owner: confirm the tier] a month." }, CLICK);
    expect(r).not.toEqual({ sendId: expect.any(Number) });
    expect(adapter.sent).toEqual([]);
  });

  it("P155 verdict 8: a booking link of any brand is never a door reason: the owner's Send is not refused for it", async () => {
    const id = await draft("A one-off slot: https://calendly.com/example-owner/15min");
    expect((await assessMessenger(depsWith(() => open), "p", id))?.reasons).toEqual([]);
  });

  it("another project's draft is not found: the door answers null and writes nothing", async () => {
    const id = await draft();
    expect(await assessMessenger(depsWith(() => open), "other", id)).toBeNull();
    expect(await applyMessenger(depsWith(() => open), "other", id, confirm, CLICK)).toBeNull();
    expect(adapter.sent).toEqual([]);
    expect(await env.repos.sends.list("p")).toEqual([]);
  });

  it("a paused or archived project is refused at the assessment, and nothing is written", async () => {
    const id = await draft();
    const paused = { ...open, lifecycle: "project p is paused, not active" };
    expect((await assessMessenger(depsWith(() => paused), "p", id))?.reasons).toContain("project p is paused, not active");
    const cap = captureOps();
    expect(await applyMessenger(depsWith(() => paused), "p", id, confirm, CLICK).finally(() => cap.stop())).toEqual({ refused: ["project p is paused, not active"] });
    expect(cap.lines.find((l) => l.message === "messenger door: refused")?.fields).toMatchObject({ stage: "assessment", actor: "admin" });
    expect(adapter.sent).toEqual([]);
    expect(await env.repos.sends.list("p")).toEqual([]);
  });

  it("a send policy changed between the assessment and the row is refused at the final checks", async () => {
    const id = await draft();
    let calls = 0;
    const r = await applyMessenger(depsWith(() => ({ ...open, generation: calls++ === 0 ? "g1" : "g2" })), "p", id, confirm, CLICK);
    expect(r).toEqual({ refused: ["the project's send policy changed while this send was checked: check it again"] });
    // A project paused in that instant is refused there too.
    calls = 0;
    expect(await applyMessenger(depsWith(() => (calls++ === 0 ? open : { ...open, lifecycle: "project p is archived, not active" })), "p", id, confirm, CLICK)).toEqual({ refused: ["project p is archived, not active"] });
    expect(adapter.sent).toEqual([]);
    expect(await env.repos.sends.list("p")).toEqual([]);
  });

  it("the confirmation is bound to the text's hash: any other text is refused", async () => {
    const id = await draft();
    expect(await applyMessenger(depsWith(() => open), "p", id, { chatId: "100", text: "Yes, the 28th stands!" }, CLICK)).toEqual({ refused: ["the draft changed after you read it: read it again and press Send again"] });
    expect(await applyMessenger(depsWith(() => open), "p", id, { chatId: "999", text: confirm.text }, CLICK)).toMatchObject({ refused: [expect.stringMatching(/changed after you read it/)] });
    expect(adapter.sent).toEqual([]);
  });

  it("an owner word is spent on one send: its reference is on the row and a second draft on the same word is refused at the audit", async () => {
    const word = { kind: "owner_word", actor: "agent_on_owner_word", ownerWord: "s1@2026-11-24T11:59:00.000Z" } as const;
    const a = await draft();
    expect(await applyMessenger(depsWith(() => open), "p", a, confirm, word)).toEqual({ sendId: expect.any(Number) });
    expect((await env.repos.sends.list("p"))[0]).toMatchObject({ actor: "agent_on_owner_word", ownerWord: word.ownerWord });
    const b = await draft("And the keys?");
    const later = { ...depsWith(() => open), now: () => new Date(NOW.getTime() + 60_000) };
    const cap = captureOps();
    const r = await applyMessenger(later, "p", b, { chatId: "100", text: "And the keys?" }, word).finally(() => cap.stop());
    expect(r).toEqual({ refused: ["this word of the owner was already used for a send: one send per word"] });
    expect(cap.lines.find((l) => l.message === "messenger door: refused")?.fields).toMatchObject({ stage: "audit", actor: "agent_on_owner_word" });
    expect(adapter.sent).toHaveLength(1);
  });

  it("decision 0048: the autopilot authority passes the same stages, spends its turn id once, and stops at its share of the account", async () => {
    const ap = (turn: string) => ({ kind: "autopilot", actor: "autopilot", turn }) as const;
    const a = await draft();
    expect(await applyMessenger(depsWith(() => open), "p", a, confirm, ap("t-one"))).toEqual({ sendId: expect.any(Number) });
    expect((await env.repos.sends.list("p"))[0]).toMatchObject({ actor: "autopilot", ownerWord: "t-one" });
    // The same turn never sends twice.
    const b = await draft("Again?");
    const later = (min: number) => ({ ...depsWith(() => open), now: () => new Date(NOW.getTime() + min * 60_000) });
    expect(await applyMessenger(later(1), "p", b, { chatId: "100", text: "Again?" }, ap("t-one"))).toMatchObject({ refused: [expect.stringMatching(/already used/)] });
    // Its share of the account (20 of the 30): the 21st autopilot send of the day is refused at the audit, the owner's click is not.
    for (let i = 2; i <= 20; i++) {
      const d = await draft(`Reply ${i}`);
      expect(await applyMessenger(later(i), "p", d, { chatId: "100", text: `Reply ${i}` }, ap(`t-${i}`))).toEqual({ sendId: expect.any(Number) });
    }
    const over = await draft("Reply 21");
    expect(await applyMessenger(later(30), "p", over, { chatId: "100", text: "Reply 21" }, ap("t-21"))).toEqual({ refused: ["autopilot sent 20 messages on this account in the last 24 hours, its share of the cap is 20"] });
    expect(await applyMessenger(later(31), "p", over, { chatId: "100", text: "Reply 21" }, CLICK)).toEqual({ sendId: expect.any(Number) });
  });

  it("the door knows no session mode: nothing in it reads a session-mode switch (decision 0048: deny lists bind the model, not the server)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["../src/door.ts", "../src/authorization.ts", "../src/send-confirmed.ts"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/unattended\s*[(:=]|instanceFeatures|agent\.unattended/);
  });
});
