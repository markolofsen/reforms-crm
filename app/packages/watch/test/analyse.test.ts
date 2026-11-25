import { describe, expect, it } from "vitest";
import { analyseGroup, analysisDue, ANALYSE_AFTER_MESSAGES } from "../src/analyse/job";
import type { NewMessage } from "../src/store/repo";
import { acmeLens, answer, fakeLlm, linesOf, tempStore } from "./support";

// P144 W5 offline (HUB_LLM fake, scripted): the window job over the store, the keep-filter, the cross-window repeat, the stored
// window and its moments, the aggregates the page reads, and the budget that stops a run.
const T0 = Date.parse("2026-11-20T10:00:00Z");
const msgs = (n: number, from = 1): NewMessage[] =>
  Array.from({ length: n }, (_, k) => ({ messageId: from + k, senderId: String(500 + ((from + k) % 7)), senderHandle: (from + k) % 7 === 0 ? null : `@p${(from + k) % 7}`, text: `garden message ${from + k}`, sentAt: new Date(T0 + (from + k) * 60_000).toISOString() }));
const now = () => new Date(T0 + 400 * 60_000);

describe("the window analysis", () => {
  it("analyses what is new with the overlap, keeps what the keep-filter allows, and stores windows and moments once", async () => {
    const store = tempStore();
    store.ensureGroups(["garden_talk"], now());
    expect(store.addMessages("garden_talk", msgs(150), now())).toBe(150);
    expect(analysisDue(store.group("garden_talk") ?? { newSinceAnalysis: 0, lastAnalysisAt: null, addedAt: "" }, now())).toBe(true);
    const lens = await acmeLens();
    const { llm, transport, ledger } = fakeLlm((req) => {
      const first = linesOf(req)[0] ?? "";
      // Every window: [1] is a kept moment; [2] is advice (dropped by keep); [3] an advert (dropped); [5] reacts to [1].
      return { content: answer([{ message_index: 1, reactor_indexes: [5, 1, 300] }, { message_index: 2, speaker_role: "advising_others" }, { message_index: 3, is_advert: true }], { topics: first.includes("message 1") ? ["Mowers", "rain"] : ["mowers"] }), costUsd: 0.0001 };
    });
    const a = await analyseGroup({ llm, store, lens, now }, "garden_talk");
    // 150 messages, windows of 100 every 80: [1..100], [81..150].
    expect(a).toMatchObject({ windows: 2, failedWindows: 0, moments: 2, stopped: null });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.model).toBe("openai/gpt-4o-mini");
    expect(linesOf(transport.requests[0] ?? fail())[0]).toBe("[1] @p1: garden message 1");
    expect(ledger.rows.every((r) => r.task === "watch.acme" && r.sourceKind === "public_chat")).toBe(true);

    const since = "2026-11-01T00:00:00.000Z";
    const moments = store.moments({ since });
    expect(moments.map((m) => m.messageId).sort((x, y) => x - y)).toEqual([1, 81]);
    expect(moments.find((m) => m.messageId === 1)).toMatchObject({ trigger: "broken_tool", intensity: 3, authorHandle: "@p1", reactorHandles: ["@p5"], quote: "my mower died", windowKey: "w100o20:garden_talk:1-100" });
    expect(store.group("garden_talk")).toMatchObject({ newSinceAnalysis: 0 });
    expect(store.triggers(since)).toEqual([{ trigger: "broken_tool", triggerOther: "", moments: 2, avgIntensity: 3, strong: 0 }]);
    // Merged case-insensitively; the first spelling seen names the cluster.
    expect(store.topics(since)).toEqual([{ topic: "Mowers", windows: 2 }, { topic: "rain", windows: 1 }]);
    expect(store.people(since).map((p) => [p.handle, p.moments, p.intensitySum]).sort()).toEqual([["@p1", 1, 3], ["@p4", 1, 3]]);
    expect(store.groupStats(since)).toEqual([{ username: "garden_talk", messages: 150, days: 1, moments: 2, costMicroUsd: 200, lastMood: "calm" }]);
    expect(store.spend(since)).toBe(200);

    // Twenty more: the next run reads from the last window's end with the overlap, and an already stored moment is not stored twice.
    store.addMessages("garden_talk", msgs(20, 151), now());
    const b = await analyseGroup({ llm, store, lens, now }, "garden_talk");
    expect(b.windows).toBe(1);
    expect(linesOf(transport.requests[2] ?? fail())[0]).toBe("[1] @p5: garden message 131");
    expect(store.moments({ since }).map((m) => m.messageId).sort((x, y) => x - y)).toEqual([1, 81, 131]);
  });

  it("a reached task budget stops the run and leaves the count, so the next due run asks again", async () => {
    const store = tempStore();
    store.ensureGroups(["g1"], now());
    store.addMessages("g1", msgs(ANALYSE_AFTER_MESSAGES), now());
    const lens = await acmeLens();
    // $2 budget: one answer that costs $2 reaches it, the next window is refused before any request.
    const { llm, transport } = fakeLlm(() => ({ content: answer([]), costUsd: 2 }));
    store.addMessages("g1", msgs(100, 101), now());
    const a = await analyseGroup({ llm, store, lens, now }, "g1");
    // 200 messages are three windows, two at a time: the third is refused before any request.
    expect(a.stopped).toBe("budget");
    expect(a.failedWindows).toBeGreaterThanOrEqual(1);
    expect(transport.requests.length).toBeLessThan(3);
    expect(store.group("g1")?.newSinceAnalysis).toBe(200);
  });

  it("is due after 100 new messages, or after 6 hours (since the last analysis, or the group's adding) with anything new; never with nothing new", () => {
    const at = new Date("2026-11-20T12:00:00Z");
    const added = "2026-11-20T11:00:00Z";
    expect(analysisDue({ newSinceAnalysis: 100, lastAnalysisAt: at.toISOString(), addedAt: added }, at)).toBe(true);
    expect(analysisDue({ newSinceAnalysis: 5, lastAnalysisAt: "2026-11-20T07:00:00Z", addedAt: added }, at)).toBe(false);
    expect(analysisDue({ newSinceAnalysis: 5, lastAnalysisAt: "2026-11-20T05:59:00Z", addedAt: added }, at)).toBe(true);
    expect(analysisDue({ newSinceAnalysis: 5, lastAnalysisAt: null, addedAt: added }, at)).toBe(false);
    expect(analysisDue({ newSinceAnalysis: 0, lastAnalysisAt: null, addedAt: "2026-01-01T00:00:00Z" }, at)).toBe(false);
  });
});

describe("the store's retention", () => {
  it("drops messages after 30 days and blanks a moment's author after 180, keeping the moment", async () => {
    const store = tempStore();
    store.ensureGroups(["g1"], now());
    store.addMessages("g1", msgs(10), now());
    store.recordWindow({ windowKey: "k", groupUsername: "g1", firstMessageId: 1, lastMessageId: 10, messages: 10, taskVersion: 1, model: "m", costMicroUsd: 5, topics: [], mood: null, firstAt: "2026-05-01T00:00:00Z", lastAt: "2026-05-01T00:00:00Z" }, [{ groupUsername: "g1", messageId: 1, trigger: "broken_tool", triggerOther: "", intensity: 4, quote: "q", authorId: "9", authorHandle: "@x", reactorHandles: ["@y"], context: "", why: "", windowKey: "k", at: "2026-05-01T00:00:00.000Z" }], now());
    const r = store.retention(new Date(T0 + 40 * 86_400_000));
    expect(r).toEqual({ messages: 10, blanked: 1 });
    expect(store.moments({})).toMatchObject([{ messageId: 1, authorId: null, authorHandle: null, reactorHandles: [], quote: "q" }]);
    expect(store.people("2026-01-01")).toEqual([]);
    expect(store.groupStats("2026-11-01T00:00:00Z")[0]?.messages).toBe(10);
  });
});

function fail(): never {
  throw new Error("no request");
}
