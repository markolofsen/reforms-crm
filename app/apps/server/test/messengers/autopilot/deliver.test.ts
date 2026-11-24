import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBrain } from "@hub/agent/autopilot";
import type { AutopilotBrain, BrainTurn } from "@hub/config/autopilot";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { SendingAdapter } from "@hub/messengers";
import { setAutopilot, writeAutopilotSwitch } from "@hub/projects/autopilot";
import { setSendPolicy } from "@hub/projects/send-policy";
import { autopilotDeliver, readDelayMs, typingMs } from "../../../src/messengers/autopilot/deliver";
import { memoryLedger } from "../../../src/messengers/autopilot/budget";
import { seedLedger } from "../../../src/messengers/autopilot/record";
import type { Clock } from "../../../src/messengers/autopilot/scheduler";
import { turnKey } from "../../../src/messengers/autopilot/scheduler";
import { createAutopilot, type AutopilotHandle } from "../../../src/messengers/autopilot/wake";
import { messengerPolicy } from "../../../src/send/messenger-policy";

// P139 A4 and A6: the autopilot's send through the door with the `autopilot` authority, on a fake adapter (nothing leaves the
// process), with only mechanical limits before it; and its Activity line per turn, which refills the budgets after a restart.

const projectMd = ["# P", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@p.example | 2026-11-14 | agent |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", ""].join("\n");

let root: string;
let policyDir: string;
let switchFile: string;
let handle: DbHandle;
let repos: Repos;
/** The owner's Telegram account as a fake: it records each confirmed draft and reaches no network. */
type FakeUserAccount = SendingAdapter & { sent: Array<{ chatId: string; text: string }> };
let adapter: FakeUserAccount;
const fakeAccount = (): FakeUserAccount => {
  const sent: Array<{ chatId: string; text: string }> = [];
  return { channel: "telegram_user", account: "42", sent, poll: async () => ({ messages: [], cursor: null }), send: async (d) => (sent.push({ chatId: d.chatId, text: d.text }), { remoteMessageId: `r${sent.length}`, at: new Date().toISOString() }) };
};
let typed: string[];

function stepClock(): Clock & { fire(): void } {
  let t = Date.UTC(2026, 10, 25, 12, 0, 0);
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

/** Fires the clock until every wait of the turn (the debounce, the slot, the read delay, the typing) has passed. */
async function settle(ap: AutopilotHandle, clock: ReturnType<typeof stepClock>) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3));
    clock.fire();
  }
  await new Promise((r) => setTimeout(r, 3));
  await ap.idle();
}

function autopilot(brain: AutopilotBrain, clock: Clock): AutopilotHandle {
  const ap = createAutopilot({ repos, files: { switchFile, policyDir, projectsDir: join(root, "projects") }, brain, clock });
  const policy = messengerPolicy({ projectsDir: join(root, "projects"), policyDir, allowList: [] });
  ap.useDeliver(autopilotDeliver({ repos, switches: ap.switches, door: () => ({ repos, policy, senders: { sender: () => adapter } }), typing: { typing: async (_c, _a, chatId) => (typed.push(chatId), true) } }));
  return ap;
}

async function inbound(id: string, text: string) {
  await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId: "1001", remoteMessageId: id, direction: "in", kind: "text", text, sentAt: new Date().toISOString(), retainUntil: "2027-01-01T00:00:00.000Z" });
}
const wake = (ap: AutopilotHandle) => ap.stored("p", [{ channel: "telegram_user", chatId: "1001", inbound: 1, outbound: 0, linked: true }]);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "hub-autopilot-deliver-"));
  mkdirSync(join(root, "projects", "p"), { recursive: true });
  writeFileSync(join(root, "projects", "p", "project.md"), projectMd);
  policyDir = join(root, "state", "projects");
  switchFile = join(root, "state", "autopilot.json");
  setSendPolicy(policyDir, "p", "generic", { "draft.recipients": "any" }, "test");
  handle = openDb(join(root, "app.db"));
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  await repos.messengers.knowChat("p", "telegram_user", "1001", { title: "Anna" });
  await repos.messengers.addIdentifier("p", await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" }), "telegram", "1001");
  await repos.messengers.noteChatFact("p", "telegram_user", "1001", { account: "42" });
  // The owner's three switches, as his routes write them.
  writeAutopilotSwitch(switchFile, true, "owner", new Date());
  setAutopilot(policyDir, "p", "generic", { kind: "mode", mode: "on" }, "owner", new Date());
  setAutopilot(policyDir, "p", "generic", { kind: "chat", chat: "telegram_user:1001", on: true }, "owner", new Date());
  adapter = fakeAccount();
  typed = [];
});
afterEach(() => handle.close());

describe("the autopilot's send (P139 A4)", () => {
  it("a send verdict goes out through the door as autopilot, after the typing status, with the daily line once; one Activity line", async () => {
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await settle(ap, clock);
    expect(adapter.sent.map((d) => d.text)).toEqual(["Thanks, noted: Does it work on Mac?\n— Mark's assistant"]);
    expect(typed).toEqual(["1001"]);
    const [row] = await repos.sends.list("p");
    expect(row).toMatchObject({ actor: "autopilot", status: "sent" });
    expect(row?.ownerWord).toMatch(/^t-/);
    const turns = await repos.runs.autopilotTurns("2000-01-01T00:00:00.000Z");
    expect(turns).toHaveLength(1);
    expect(JSON.parse(turns[0]?.detail ?? "{}")).toMatchObject({ action: "autopilot_sent", autopilot: { outcome: "sent", chat: "telegram_user:1001", ran: true, sendId: row?.id } });
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedAt).toBeNull();
  });

  it("after today's first autopilot message, the next turn carries no daily line", async () => {
    const clock = stepClock();
    const seen: BrainTurn[] = [];
    const real = fakeBrain({ repos });
    const ap = autopilot({ name: "fake", turn: (t, s) => (seen.push(t), real.turn(t, s)) }, clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await settle(ap, clock);
    await inbound("2", "And what is the price?");
    wake(ap);
    await settle(ap, clock);
    expect(seen.map((t) => t.disclose)).toEqual([true, false]);
  });

  it("the model's hand-back sends nothing: the draft waits as autopilot's and the chat pauses", async () => {
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "What is the price?");
    wake(ap);
    await settle(ap, clock);
    expect(adapter.sent).toEqual([]);
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("model_hand_back");
    expect(await repos.messengers.openDraft("p", "telegram_user", "1001")).toMatchObject({ createdBy: "autopilot" });
  });

  it("quiet hours: the reply waits and the chat hands back", async () => {
    setAutopilot(policyDir, "p", "generic", { kind: "quiet", quiet: { from: "00:00", to: "23:59", tz: "UTC" } }, "owner", new Date());
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await settle(ap, clock);
    expect(adapter.sent).toEqual([]);
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("quiet_hours");
  });

  it("autopilot's share of the account used up: it hands back before the door", async () => {
    const at = Date.now() - 3_600_000;
    for (let i = 0; i < 20; i++) {
      const d = await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: `old ${i}`, createdBy: "autopilot" });
      const r = await repos.sends.beginMessage({ project: "p", channel: "telegram_user", messengerDraftId: d.id, account: "42", to: "telegram:1001", name: "Anna", text: `old ${i}`, actor: "autopilot", at: new Date(at + i * 60_000).toISOString(), limits: { dailyCap: 30, spacingSeconds: 20 } });
      await repos.sends.markSent(r.id, `r${i}`);
    }
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await settle(ap, clock);
    expect(adapter.sent).toEqual([]);
    expect((await repos.messengers.chat("p", "telegram_user", "1001"))?.autopilotPausedReason).toBe("account_budget");
  });

  it("a switch turned off while the reply waits for its slot: nothing is sent", async () => {
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await new Promise((r) => setTimeout(r, 3));
    clock.fire(); // the debounce: the turn runs and waits for its slot and its read delay
    await new Promise((r) => setTimeout(r, 5));
    setAutopilot(policyDir, "p", "generic", { kind: "chat", chat: "telegram_user:1001", on: false }, "owner", new Date());
    await settle(ap, clock);
    expect(adapter.sent).toEqual([]);
  });

  it("pacing: a read delay of 2-6 s, and typing for 1.5 s + 35 ms a character, at most 12 s, with jitter", () => {
    expect(readDelayMs(() => 0)).toBe(2_000);
    expect(readDelayMs(() => 1)).toBe(6_000);
    expect(typingMs("x".repeat(100), () => 0.5)).toBe(5_000);
    expect(typingMs("x".repeat(10_000), () => 0.5)).toBe(12_000);
    expect(typingMs("x".repeat(100), () => 0)).toBe(4_000);
  });
});

describe("the turn record refills the budgets after a restart (P139 A6)", () => {
  it("reads back the turns that ran and autopilot's sends of the last day", async () => {
    const clock = stepClock();
    const ap = autopilot(fakeBrain({ repos }), clock);
    await inbound("1", "Does it work on Mac?");
    wake(ap);
    await settle(ap, clock);
    const ledger = memoryLedger();
    expect(await seedLedger(repos, ledger, new Date())).toEqual({ turns: 1, sends: 1 });
    const key = turnKey({ project: "p", channel: "telegram_user", chatId: "1001" });
    expect(ledger.turnsSince(key, 0)).toBe(1);
    expect(ledger.sendsSince(key, 0)).toBe(1);
  });
});
