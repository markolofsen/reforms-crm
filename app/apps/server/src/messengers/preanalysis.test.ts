import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { messengerChatsDto } from "@hub/contract/messenger-panel";
import { createLlm, fakeTransport, memoryLedger, type ChatRequest, type FakeScript } from "@hub/llm";
import { testApp } from "../test-support/runtime";
import { createPreanalysis, PREANALYSIS_TASK, preanalysisStanding } from "./preanalysis";

// P71 M-P: the pre-analysis of linked chats on the fake model (decision 0039 point 7: no network). Its "Done when": a batch with one
// broken item hides nothing it could not judge, and the counts by reason show on the panel.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const quick = { sleep: async () => {}, random: () => 0 };

let handle: DbHandle;
let repos: Repos;
let seq = 0;

const msg = (chatId: string, direction: "in" | "out", minute: number, text: string, kind = "text") =>
  repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "1", chatId, remoteMessageId: `${chatId}-${++seq}`, direction, kind, text, sentAt: new Date(NOW.getTime() - (600 - minute) * 60_000).toISOString(), retainUntil: "2099-01-01T00:00:00Z" });

/** The items the batch request carried (the user message's JSON). */
const sentItems = (req: ChatRequest): Array<{ i: number; input: { text: string; before: Array<{ from: string; text: string }> } }> => {
  try {
    const json: unknown = JSON.parse(req.messages.at(-1)?.content ?? "null");
    const p = z.object({ items: z.array(z.object({ i: z.number(), input: z.object({ text: z.string(), before: z.array(z.object({ from: z.string(), text: z.string() })) }) })) }).safeParse(json);
    return p.success ? p.data.items : [];
  } catch {
    return [];
  }
};

/** Labels by the text's first word; the item whose text starts with "BROKEN" gets an answer outside the schema, alone too. */
const byWord: FakeScript = (req) => {
  const items = sentItems(req);
  if (items.length === 0) return { content: '{"label":"bogus"}' };
  const label = (t: string) => (t.startsWith("thanks") ? "closing" : t.startsWith("code") ? "automated" : t.startsWith("BROKEN") ? "bogus" : "needs_reply");
  return { content: JSON.stringify({ items: items.map((x) => ({ i: x.i, value: { label: label(x.input.text) } })) }) };
};

const setup = (script?: FakeScript) => {
  const transport = fakeTransport(script);
  const llm = createLlm({ ledger: memoryLedger(), transport, retry: quick });
  return { transport, job: createPreanalysis({ repos, llm, now: () => NOW }) };
};

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  const anna = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna Field" });
  await repos.messengers.allowChat("p", "telegram_user", "1001", "Anna's flat chat");
  await repos.messengers.addIdentifier("p", anna, "telegram", "1001");
  await repos.messengers.setChatRules("p", "telegram_user", "1001", { prefilter: true });
  // A second linked chat with the switch off: never judged.
  await repos.messengers.allowChat("p", "telegram_user", "2002", "Bob");
  await msg("2002", "in", 1, "thanks a lot");
});
afterEach(() => handle.close());

describe("the pre-analysis (P71 M-P)", () => {
  it("one broken item: it is stored unjudged and reaches the agent; only what was judged hidden is hidden, and the panel counts by reason", async () => {
    await msg("1001", "in", 10, "Is the flat still free?");
    await msg("1001", "out", 11, "Yes it is.");
    await msg("1001", "in", 12, "thanks!");
    await msg("1001", "in", 13, "code 4471 is your login code");
    await msg("1001", "in", 14, "BROKEN please answer in a strange way");
    await msg("1001", "in", 15, "", "photo");
    const { transport, job } = setup(byWord);

    const r = await job.run("p");
    expect(r).toEqual({ judged: 3, hidden: 2, unjudged: 1, failed: 0 });
    // One batch request; the broken item then took the alone ladder. The task is named, the preset's model, never a chat.
    expect(transport.requests.length).toBeGreaterThan(1);
    const first = transport.requests[0];
    expect(sentItems(first!).map((x) => x.input.text)).toEqual(["Is the flat still free?", "thanks!", "code 4471 is your login code", "BROKEN please answer in a strange way"]);
    // Judge the body, not the frame: no title, name, chat id, account or e-mail in any request; the owner's reply is context by side.
    const wire = JSON.stringify(transport.requests);
    for (const s of ["Anna", "flat chat", "1001", "anna@example.test", "Bob"]) expect(wire.includes(s), s).toBe(false);
    expect(sentItems(first!)[1]?.input.before).toEqual([
      { from: "client", text: "Is the flat still free?" },
      { from: "owner", text: "Yes it is." },
    ]);

    const rows = handle.db.$client.prepare("select m.text, t.verdict from messenger_triage t join messenger_messages m on m.id = t.message_id order by m.sent_at").all();
    expect(rows).toEqual([
      { text: "Is the flat still free?", verdict: "needs_reply" },
      { text: "thanks!", verdict: "closing" },
      { text: "code 4471 is your login code", verdict: "automated" },
      { text: "BROKEN please answer in a strange way", verdict: "unjudged" },
    ]);

    const app = testApp(repos, { adminPort: ADMIN, preanalysis: job });
    const list = messengerChatsDto.parse(await (await app.request(`${BASE}/api/projects/p/messengers/chats?filter=all`, { headers: HEADERS })).json());
    const anna = list.chats.find((c) => c.chatId === "1001");
    expect(anna?.triage).toEqual({ judged: 3, hidden: { closing: 1, automated: 1, personal: 0 }, unjudged: 1 });
    expect(list.chats.find((c) => c.chatId === "2002")?.triage).toEqual({ judged: 0, hidden: { closing: 0, automated: 0, personal: 0 }, unjudged: 0 });
    expect(list.preanalysis).toEqual({ state: "fake", fix: null });

    // A second pass asks nothing: every message has its verdict, the unjudged one included (never re-asked).
    const n = transport.requests.length;
    expect(await job.run("p")).toMatchObject({ skipped: "nothing" });
    expect(transport.requests.length).toBe(n);
  });

  it("a hidden newest message owes no reply on the panel; a visible one does", async () => {
    await msg("1001", "in", 10, "Is the flat still free?");
    await msg("1001", "in", 12, "thanks!");
    const { job } = setup(byWord);
    await job.run("p");
    const app = testApp(repos, { adminPort: ADMIN, preanalysis: job });
    const chat = async () => messengerChatsDto.parse(await (await app.request(`${BASE}/api/projects/p/messengers/chats?filter=all`, { headers: HEADERS })).json()).chats.find((c) => c.chatId === "1001");
    expect(await chat()).toMatchObject({ owed: false, last: { text: "thanks!", hidden: "closing" } });
    await msg("1001", "in", 20, "And the price?");
    expect(await chat()).toMatchObject({ owed: true, last: { text: "And the price?", hidden: null } });
  });

  it("the unscripted fake (HUB_LLM=fake) hides nothing: its first label is the fail-open one", async () => {
    await msg("1001", "in", 10, "thanks!");
    const { job } = setup();
    expect(await job.run("p")).toEqual({ judged: 1, hidden: 0, unjudged: 0, failed: 0 });
  });

  it("a request that fails as a whole (the cap, the network) stores nothing: the messages reach the agent and a later pass asks again", async () => {
    await msg("1001", "in", 10, "Is the flat still free?");
    const { job } = setup(() => ({ error: "credits", status: 402 }));
    expect(await job.run("p")).toEqual({ judged: 0, hidden: 0, unjudged: 0, failed: 1 });
    expect(handle.db.$client.prepare("select count(*) n from messenger_triage").get()).toEqual({ n: 0 });
  });

  it("no key: nothing is asked, no ledger row is written, and the switch says it needs an OpenRouter key", async () => {
    await msg("1001", "in", 10, "Is the flat still free?");
    const ledger = memoryLedger();
    const env = { ...process.env, OPENROUTER_API_KEY: "", HUB_LLM: "" };
    const job = createPreanalysis({ repos, llm: createLlm({ ledger, env }), env, now: () => NOW });
    expect(job.standing().state).toBe("no_key");
    expect(job.standing().fix).toMatch(/OPENROUTER_API_KEY/);
    expect(preanalysisStanding(env).state).toBe("no_key");
    expect(await job.run("p")).toMatchObject({ skipped: "no_key" });
    expect(ledger.rows).toEqual([]);
    const app = testApp(repos, { adminPort: ADMIN, preanalysis: job });
    const list = messengerChatsDto.parse(await (await app.request(`${BASE}/api/projects/p/messengers/chats?filter=all`, { headers: HEADERS })).json());
    expect(list.preanalysis.state).toBe("no_key");
  });

  it("only recent inbound text of chats with the switch on; our own messages and media are never judged", async () => {
    await msg("1001", "out", 10, "Hello from us");
    await msg("1001", "in", 11, "", "voice");
    await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "1", chatId: "1001", remoteMessageId: "old", direction: "in", text: "a week and more ago", sentAt: "2026-11-01T00:00:00.000Z", retainUntil: "2099-01-01T00:00:00Z" });
    const { transport, job } = setup(byWord);
    expect(await job.run("p")).toMatchObject({ skipped: "nothing" });
    expect(transport.requests).toEqual([]);
  });

  it("turning the switch on starts one pass; passes are single-flight, and a call during one runs one more after it", async () => {
    await repos.messengers.setChatRules("p", "telegram_user", "1001", { prefilter: false });
    await msg("1001", "in", 10, "thanks!");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const script: FakeScript = async (req, n) => {
      if (n === 0) await gate;
      return byWord(req, n);
    };
    const { transport, job } = setup(script);
    const app = testApp(repos, { adminPort: ADMIN, preanalysis: job });
    const id = (await repos.messengers.chat("p", "telegram_user", "1001"))?.id;
    const put = await app.request(`${BASE}/api/projects/p/messengers/chats/${id}/rules`, { method: "PUT", headers: HEADERS, body: JSON.stringify({ prefilter: true }) });
    expect(put.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(transport.requests).toHaveLength(1);
    await msg("1001", "in", 20, "code 1234");
    job.after("p");
    job.after("p");
    expect(transport.requests).toHaveLength(1);
    release();
    await job.idle();
    // The first pass, then exactly one more for the message stored during it.
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.every((r) => r.messages[0]?.content.startsWith("You sort the messages"))).toBe(true);
    expect(handle.db.$client.prepare("select verdict from messenger_triage order by id").all()).toEqual([{ verdict: "closing" }, { verdict: "automated" }]);
  });

  it("the ledger names the task; the purge and unlinking take the verdicts with their messages", async () => {
    await msg("1001", "in", 10, "thanks!");
    const ledger = memoryLedger();
    const llm = createLlm({ ledger, transport: fakeTransport(byWord), retry: quick });
    await createPreanalysis({ repos, llm, now: () => NOW }).run("p");
    expect(ledger.rows.map((r) => r.task)).toEqual([PREANALYSIS_TASK]);
    expect(handle.db.$client.prepare("select count(*) n from messenger_triage").get()).toEqual({ n: 1 });
    await repos.messengers.unlinkChat("p", "telegram_user", "1001");
    expect(handle.db.$client.prepare("select count(*) n from messenger_triage").get()).toEqual({ n: 0 });
  });
});
