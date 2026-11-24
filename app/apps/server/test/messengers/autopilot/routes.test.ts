import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutopilotBrain, BrainResult } from "@hub/config/autopilot";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { captureOps } from "@hub/log/ops";
import { readSendPolicy, setSendPolicy } from "@hub/projects/send-policy";
import { testApp } from "../../support/runtime";
import { createAutopilot, type AutopilotHandle } from "../../../src/messengers/autopilot/wake";
import type { Clock } from "../../../src/messengers/autopilot/scheduler";

// P139 A1 and A2: the owner's autopilot routes (the admin's Origin and a single-use ticket per scope; only they write the two
// files), and the wake from the ingest through the precheck to a fake brain and the pause. Nothing is sent: there is no sender.

const projectMd = ["# P", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@p.example | 2026-11-14 | agent |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", ""].join("\n");

const BASE = "http://127.0.0.1:4317";
const H = { "content-type": "application/json" };
const ADMIN = { ...H, origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };

let root: string;
let policyDir: string;
let switchFile: string;
let handle: DbHandle;
let repos: Repos;
let chatRow: number;

/** A clock whose timers fire when `fire()` is called (the debounce), so the test needs no real waits. */
function stepClock(): Clock & { fire(): void } {
  let t = Date.UTC(2026, 10, 24, 12, 0, 0);
  const timers = new Map<number, () => void>();
  let n = 0;
  return {
    now: () => t,
    random: () => 0,
    setTimeout: (fn) => (timers.set(++n, fn), n),
    clearTimeout: (h) => void timers.delete(h as number),
    fire: () => {
      t += 10_000;
      const due = [...timers.values()];
      timers.clear();
      for (const f of due) f();
    },
  };
}

const fakeBrain = (r: BrainResult): AutopilotBrain & { calls: number } => {
  const b = { name: "fake", calls: 0, turn: async () => (b.calls++, r) };
  return b;
};

function autopilot(o: { brain?: AutopilotBrain; clock?: Clock } = {}): AutopilotHandle {
  return createAutopilot({ repos, files: { switchFile, policyDir, projectsDir: join(root, "projects") }, ...o });
}
const appOf = (ap: AutopilotHandle) => testApp(repos, { adminPort: 5173, autopilot: ap });
type App = ReturnType<typeof appOf>;

const ticket = async (app: App, body: Record<string, unknown>) => ((await (await app.request(`${BASE}/api/autopilot/tickets`, { method: "POST", headers: ADMIN, body: JSON.stringify(body) })).json()) as { ticket: string }).ticket;
const putInstance = async (app: App, on: boolean) => app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ on, ticket: await ticket(app, { scope: "instance" }) }) });
const putProject = async (app: App, change: Record<string, unknown>) =>
  app.request(`${BASE}/api/projects/p/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ ...change, ticket: await ticket(app, { scope: "project", project: "p" }) }) });

async function inbound(id: string, text = "Is the 28th still on?") {
  await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1001", remoteMessageId: id, direction: "in", kind: "text", text, sentAt: new Date().toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "hub-autopilot-"));
  mkdirSync(join(root, "projects", "p"), { recursive: true });
  writeFileSync(join(root, "projects", "p", "project.md"), projectMd);
  policyDir = join(root, "state", "projects");
  switchFile = join(root, "state", "autopilot.json");
  setSendPolicy(policyDir, "p", "generic", { "draft.recipients": "any" }, "test");
  handle = openDb(join(root, "app.db"));
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  await repos.messengers.allowChat("p", "telegram_user", "1001", "Anna");
  chatRow = (await repos.messengers.chat("p", "telegram_user", "1001"))?.id ?? 0;
});
afterEach(() => handle.close());

describe("the owner's autopilot routes (P139 A1, verdict 5)", () => {
  it("reads off everywhere until the owner switches, and lists every linked chat with why it is off", async () => {
    const app = appOf(autopilot());
    expect(await (await app.request(`${BASE}/api/autopilot`)).json()).toEqual({ on: false, updatedAt: null, by: null, error: null });
    const p = (await (await app.request(`${BASE}/api/projects/p/autopilot`)).json()) as { mode: string; chats: Array<Record<string, unknown>> };
    expect(p.mode).toBe("off");
    expect(p.chats).toEqual([expect.objectContaining({ chat: chatRow, listed: false, state: "off", off: "instance" })]);
    expect((await app.request(`${BASE}/api/projects/nope/autopilot`)).status).toBe(404);
  });

  it("refuses a write from anything but the admin page, without a ticket, with a spent one, or one for another scope", async () => {
    const app = appOf(autopilot());
    expect((await app.request(`${BASE}/api/autopilot/tickets`, { method: "POST", headers: H, body: JSON.stringify({ scope: "instance" }) })).status).toBe(403);
    expect((await app.request(`${BASE}/api/autopilot/tickets`, { method: "POST", headers: { ...ADMIN, "sec-fetch-site": "same-site" }, body: JSON.stringify({ scope: "instance" }) })).status).toBe(403);
    expect((await app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ on: true, ticket: "made-up" }) })).status).toBe(403);
    const t = await ticket(app, { scope: "project", project: "p" });
    expect((await app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ on: true, ticket: t }) })).status).toBe(403);
    const good = await ticket(app, { scope: "instance" });
    expect((await app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: H, body: JSON.stringify({ on: true, ticket: good }) })).status).toBe(403);
    expect(existsSync(switchFile)).toBe(false);
    expect(readSendPolicy(policyDir, "p", "generic").policy.autopilot).toBeUndefined();
    // The gate refuses before the ticket is looked at; the admin page's own write spends it, once.
    expect((await app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ on: true, ticket: good }) })).status).toBe(200);
    expect((await app.request(`${BASE}/api/autopilot`, { method: "PUT", headers: ADMIN, body: JSON.stringify({ on: false, ticket: good }) })).status).toBe(403);
  });

  it("writes the instance file and the project's block through the one writer; a chat switched on loses its pause", async () => {
    const ap = autopilot();
    const app = appOf(ap);
    expect((await putInstance(app, true)).status).toBe(200);
    expect(JSON.parse(readFileSync(switchFile, "utf8"))).toMatchObject({ schema: 1, on: true, by: "owner" });
    expect((await putProject(app, { kind: "mode", mode: "dry_run" })).status).toBe(200);
    await repos.messengers.setAutopilotPause("p", "telegram_user", "1001", "owner_replied");
    const r = await putProject(app, { kind: "chat", chat: chatRow, on: true });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { chats: unknown[] }).chats).toEqual([expect.objectContaining({ listed: true, state: "dry_run", off: null, pausedAt: null })]);
    const policy = readSendPolicy(policyDir, "p", "generic").policy;
    expect(policy).toMatchObject({ recipients: "any", by: "owner", autopilot: { mode: "dry_run", chats: ["telegram_user:1001"], disclose: "daily", quiet: null } });
    expect((await putProject(app, { kind: "chat", chat: 99999, on: true })).status).toBe(404);
  });

  it("a hand-back pause reads as paused with its words, and a reply mode other than Draft replies keeps it off", async () => {
    const app = appOf(autopilot());
    await putInstance(app, true);
    await putProject(app, { kind: "mode", mode: "on" });
    await putProject(app, { kind: "chat", chat: chatRow, on: true });
    await repos.messengers.setAutopilotPause("p", "telegram_user", "1001", "looks_like_bot");
    let p = (await (await app.request(`${BASE}/api/projects/p/autopilot`)).json()) as { chats: Array<Record<string, unknown>> };
    expect(p.chats[0]).toMatchObject({ state: "paused", pausedReason: "looks_like_bot", pausedWords: "looks like a bot" });
    await repos.messengers.setChatRules("p", "telegram_user", "1001", { replyMode: "on_request" });
    p = (await (await app.request(`${BASE}/api/projects/p/autopilot`)).json()) as { chats: Array<Record<string, unknown>> };
    expect(p.chats[0]).toMatchObject({ state: "off", off: "reply_mode" });
  });
});

describe("the wake from the ingest (P139 A2)", () => {
  async function switchedOn(ap: AutopilotHandle, mode: "dry_run" | "on" = "dry_run") {
    const app = appOf(ap);
    await putInstance(app, true);
    await putProject(app, { kind: "mode", mode });
    await putProject(app, { kind: "chat", chat: chatRow, on: true });
  }

  it("does nothing in a chat whose switches are off: no turn, no line", async () => {
    const brain = fakeBrain({ kind: "draft", draftId: 1, verdict: "send", reason: "ok", costUsd: 0 });
    const clock = stepClock();
    const ap = autopilot({ brain, clock });
    const cap = captureOps();
    await inbound("1");
    ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 1, outbound: 0, linked: true }]);
    await ap.idle();
    clock.fire();
    await ap.idle();
    cap.stop();
    expect(brain.calls).toBe(0);
    expect(cap.lines.filter((l) => l.source === "autopilot")).toEqual([]);
  });

  it("a client message in a switched-on chat runs one turn on the brain; a dry run sends nothing and leaves the chat on", async () => {
    const brain = fakeBrain({ kind: "draft", draftId: 5, verdict: "send", reason: "ok", costUsd: 0.01 });
    const clock = stepClock();
    const ap = autopilot({ brain, clock });
    await switchedOn(ap);
    const cap = captureOps();
    await inbound("1");
    ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 1, outbound: 0, linked: true }]);
    await ap.idle();
    clock.fire();
    await ap.idle();
    cap.stop();
    expect(brain.calls).toBe(1);
    expect(cap.lines.filter((l) => l.source === "autopilot" && l.message.startsWith("turn"))).toEqual([expect.objectContaining({ message: "turn dry_run", fields: expect.objectContaining({ outcome: "dry_run", draft: 5 }) })]);
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedAt).toBeNull();
  });

  it("mode on with no sender yet ends skipped: no_sender; the model's hand-back pauses the chat", async () => {
    const clock = stepClock();
    let ap = autopilot({ brain: fakeBrain({ kind: "draft", draftId: 5, verdict: "send", reason: "ok", costUsd: null }), clock });
    await switchedOn(ap, "on");
    const cap = captureOps();
    await inbound("1");
    ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 1, outbound: 0, linked: true }]);
    await ap.idle();
    clock.fire();
    await ap.idle();
    expect(cap.lines.filter((l) => l.source === "autopilot" && l.message.startsWith("turn")).map((l) => l.fields?.reason)).toEqual(["no_sender"]);
    ap = autopilot({ brain: fakeBrain({ kind: "draft", draftId: 6, verdict: "hand_back", reason: "price", costUsd: null }), clock });
    await inbound("2");
    ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 1, outbound: 0, linked: true }]);
    await ap.idle();
    clock.fire();
    await ap.idle();
    cap.stop();
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("model_hand_back");
  });

  it("the owner's own message in the chat pauses it (verdict 16), and the restart scan hands back an old unanswered message (verdict 23)", async () => {
    const clock = stepClock();
    const ap = autopilot({ brain: fakeBrain({ kind: "no_draft", reason: "x", costUsd: null }), clock });
    await switchedOn(ap);
    ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 0, outbound: 1, linked: true }]);
    await ap.idle();
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("owner_replied");
    await repos.messengers.setAutopilotPause("p", "telegram_user", "1001", null);
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1001", remoteMessageId: "old", direction: "in", kind: "text", text: "hello?", sentAt: new Date(clock.now() - 3_600_000).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
    await ap.scan();
    await ap.idle();
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("missed_while_off");
  });

  it("the restart scan leaves alone a chat whose newest message was hidden or whose draft already waits", async () => {
    const clock = stepClock();
    const ap = autopilot({ brain: fakeBrain({ kind: "no_draft", reason: "x", costUsd: null }), clock });
    await switchedOn(ap);
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1001", remoteMessageId: "old", direction: "in", kind: "text", text: "thanks!", sentAt: new Date(clock.now() - 3_600_000).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
    const [msg] = await repos.messengers.messagesOf("p", [{ channel: "telegram_user", chatId: "1001" }], { limit: 1 });
    await repos.messengers.recordTriage("p", [{ messageId: msg?.id ?? 0, verdict: "closing", model: "m", promptVersion: 1 }]);
    await ap.scan();
    await ap.idle();
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedAt).toBeNull();
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1001", remoteMessageId: "old2", direction: "in", kind: "text", text: "and the price?", sentAt: new Date(clock.now() - 3_000_000).toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
    await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "A dry run's reply", createdBy: "agent" });
    await ap.scan();
    await ap.idle();
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedAt).toBeNull();
  });
});
