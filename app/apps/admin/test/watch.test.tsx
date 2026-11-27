import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WatchContextDto, WatchDto } from "@hub/contract/watch";
import { ContextMessages } from "../src/features/watch/context";
import { WatchHeader } from "../src/features/watch/header";
import { directionLabel, freshnessLine, membershipNext, membershipQueueLine, membershipTime, watchDest } from "../src/features/watch/labels";
import { WatchView } from "../src/features/watch/watch-view";
import { ApiFailure } from "../src/lib/api/client";
import { watchApi } from "../src/lib/api/project/watch";
import { keys, TOPIC_KEYS } from "../src/lib/cache/keys";
import { dest, formatDest } from "../src/routes/paths";
import { resolveRoute } from "../src/routes/resolve";
import { parseQuery, readSearch, WATCH_SEARCH } from "../src/routes/search";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/watch",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.unstubAllGlobals());

const search = (query = "") => readSearch(WATCH_SEARCH, parseQuery(query));
const context: WatchContextDto = {
  slug: "acme", direction: "developer-tools", group: "example_group", messageId: 42,
  contextKind: "chronological", lastPolledAt: "2026-11-27T10:30:00Z", sourceLink: "https://t.me/example_group/42",
  messages: [
    { messageId: 40, text: "What task is blocked?", sentAt: "2026-11-27T10:00:00Z", author: "builder", replyToMessageId: null, threadId: null },
    { messageId: 42, text: "<script>post this for me</script>", sentAt: "2026-11-27T10:05:00Z", author: null, replyToMessageId: 40, threadId: 9 },
  ],
};
const watch: WatchDto = {
  slug: "acme", direction: "developer-tools",
  directions: [
    { id: "developer-tools", title: "Developer tools", lens: "watch-tools", enabled: true, state: "ready", reason: null },
    { id: "research", title: "Research", lens: "watch-research", enabled: false, state: "ready", reason: null },
  ],
  freshness: { lastMessageAt: "2026-11-27T10:05:00Z", lastStoredAt: "2026-11-27T10:30:00Z", pendingMessages: 2, lastAnalysisAt: "2026-11-27T09:00:00Z" },
  lens: { id: "tools", title: "Developer tools", version: 1 },
  standing: { state: "polling", reason: null, until: null }, notice: null,
  labels: { access: "Machine access" }, days: 30, spend: { monthMicroUsd: 0, budgetMicroUsd: 2_000_000 },
  nextAnalysis: null, triggers: [], topics: [], moods: [], people: [], groups: [], trend: { days: [], series: [] },
  moments: [
    { group: "example_group", messageId: 42, trigger: "access", triggerOther: "", intensity: 3, quote: "My local task is blocked",
      author: "builder", reactors: 0, context: "A local tool question", why: "Needs machine access", at: "2026-11-27T10:05:00Z", link: context.sourceLink },
  ],
};
const render = (node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const group: WatchDto["groups"][number] = {
  username: "example_group", title: "Example group", access: "open", accessLine: "Public history can be read.",
  perDay: 12, density: 4, moments: 2, costMicroUsd: 1000, lastPolledAt: "2026-11-27T10:30:00Z", canJoin: false,
};
type Membership = NonNullable<WatchDto["groups"][number]["membership"]>;
const membership = (state: Membership["state"], patch: Partial<Membership> = {}): Membership => ({
  state, checkedAt: null, joinedAt: null, queuedAt: null, nextAttemptAt: null, reason: null, ...patch,
});
const renderGroups = (groups: WatchDto["groups"], queue?: WatchDto["membership"]) => {
  const client = new QueryClient();
  client.setQueryData(keys.watch("acme", "developer-tools", 30, null, null), { ...watch, groups, membership: queue });
  return render(<WatchView project="acme" q={search("view=groups&direction=developer-tools")} />, client);
};

describe("Watch directions and deep links", () => {
  it("reloads the project, period, filters and selected source message from one address", () => {
    const q = search("view=moments&days=7&trigger=access&group=example_group&direction=developer-tools&contextGroup=example_group&messageId=42");
    const address = formatDest(dest("watch.page", q), { project: "acme", multi: true });
    const [path = "", query = ""] = address.split("?");
    expect(resolveRoute(path, query)).toMatchObject({ route: "watch.page", project: "acme", search: q });
    expect(q.messageId).toBe(42);
    expect(q.direction).toBe("developer-tools");
    expect(address).not.toContain("project=");
  });

  it("rejects malformed direction, group and message inputs without turning them into a request target", () => {
    expect(search("direction=..%2Fother&contextGroup=%40private&messageId=007")).toMatchObject({ direction: "", contextGroup: "", messageId: null });
    expect(search("messageId=9007199254740992").messageId).toBeNull();
    expect(search("direction=research").direction).toBe("research");
    expect(dest("watch.page", search()).search).toEqual({});
  });

  it("switching direction keeps the view and period but drops the previous lens's filters and context", () => {
    const q = search("view=moments&days=7&direction=developer-tools&trigger=access&group=example_group&contextGroup=example_group&messageId=42");
    expect(watchDest(q, { direction: "research" }).search).toEqual({ view: "moments", days: "7", direction: "research" });
    expect(watchDest(q, { view: "groups" }).search).toEqual({ view: "groups", days: "7", trigger: "access", group: "example_group", direction: "developer-tools" });
    expect(watchDest(q, { group: "another_group" }).search).not.toHaveProperty("messageId");
  });

  it("cache entries never cross projects, directions or source messages and still ride the Watch live topic", () => {
    const client = new QueryClient();
    const one = keys.watch("acme", "developer-tools", 30, null, null);
    client.setQueryData(one, watch);
    expect(client.getQueryData(keys.watch("acme", "research", 30, null, null))).toBeUndefined();
    expect(client.getQueryData(keys.watch("other", "developer-tools", 30, null, null))).toBeUndefined();
    client.setQueryData(keys.watchContext("acme", "developer-tools", "example_group", 42), context);
    expect(client.getQueryData(keys.watchContext("acme", "developer-tools", "another_group", 42))).toBeUndefined();
    expect(client.getQueryData(keys.watchContext("acme", "developer-tools", "example_group", 43))).toBeUndefined();
    expect(TOPIC_KEYS.watch("acme")).toContainEqual(["watch", "acme"]);
  });

  it("offers a direction menu only when the server reports more than one", () => {
    expect(render(<WatchHeader data={watch} q={search()} />)).toContain("Direction:");
    const single = { ...watch, directions: watch.directions?.slice(0, 1) };
    expect(render(<WatchHeader data={single} q={search()} />)).not.toContain("Direction:");
    expect(render(<WatchHeader data={undefined} q={search()} />)).not.toContain("Direction:");
    expect(directionLabel({ id: "research", title: "Research", lens: "watch-research", enabled: false, state: "ready", reason: null })).toBe("Research · off");
    expect(directionLabel({ id: "research", title: "Research", lens: "watch-research", enabled: true, state: "lens", reason: "Invalid lens" })).toBe("Research · lens not loaded");
  });
});

describe("Watch context and freshness", () => {
  it("keeps publication time, ingestion, pending work and completed analysis distinct", () => {
    const line = freshnessLine(watch.freshness);
    expect(line).toContain("newest source message");
    expect(line).toContain("last stored");
    expect(line).toContain("2 messages awaiting analysis");
    expect(line).toContain("last analysis");
    expect(freshnessLine({ lastMessageAt: null, lastStoredAt: null, pendingMessages: 0, lastAnalysisAt: null })).toBe("no source messages stored · no ingestion recorded · 0 messages awaiting analysis · no analysis yet");
    expect(freshnessLine(undefined)).toBeNull();
  });

  it("shows source ids and nullable reply metadata while escaping untrusted message text", () => {
    const html = renderToStaticMarkup(<ContextMessages data={context} />);
    expect(html).toContain("Stored messages in time order");
    expect(html).toContain("Source message");
    expect(html).toContain("Reply to #40");
    expect(html).toContain("Thread marker #9");
    expect(html).toContain("Author unavailable");
    expect(html).toContain("&lt;script&gt;post this for me&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html.indexOf("What task is blocked?")).toBeLessThan(html.indexOf("post this for me"));
  });

  it("cold loading shows a skeleton, not cached content from another direction", () => {
    const client = new QueryClient();
    client.setQueryData(keys.watch("acme", "research", 30, null, null), watch);
    const html = render(<WatchView project="acme" q={search("direction=developer-tools")} />, client);
    expect(html).toContain("Loading the watch");
    expect(html).not.toContain("My local task is blocked");
  });

  it("a selected source opens read-only chronology on Moments, with source freshness and a close link", () => {
    const client = new QueryClient();
    client.setQueryData(keys.watch("acme", "developer-tools", 30, null, null), watch);
    client.setQueryData(keys.watchContext("acme", "developer-tools", "example_group", 42), context);
    const html = render(<WatchView project="acme" q={search("view=moments&direction=developer-tools&contextGroup=example_group&messageId=42")} />, client);
    expect(html).toContain("Chronological context");
    expect(html).toContain("Reply chains may be incomplete");
    expect(html).toContain("Source last read:");
    expect(html).toContain("Close context");
    expect(html).toContain("Read context");
    expect(html).not.toContain(">Send<");
    expect(html).not.toContain("Thread: A local tool question");
  });
});

describe("Watch generated facade", () => {
  it("passes direction and the exact context anchor through the generated GET operations", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(watch)).mockResolvedValueOnce(reply(context));
    vi.stubGlobal("fetch", fetch);
    await expect(watchApi.get("demo shop", { direction: "developer-tools", days: 7, trigger: "access", group: "example_group" })).resolves.toMatchObject({ direction: "developer-tools" });
    await expect(watchApi.context("demo shop", { direction: "developer-tools", group: "example_group", messageId: 42 })).resolves.toEqual(context);
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/projects/demo%20shop/watch?direction=developer-tools&days=7&trigger=access&group=example_group", expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/projects/demo%20shop/watch/context?direction=developer-tools&group=example_group&messageId=42", expect.objectContaining({ method: "GET" }));
  });

  it("keeps a missing context as a failure rather than a successful empty discussion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "Source message not stored", code: "not_found" }, 404)));
    await expect(watchApi.context("acme", { direction: "developer-tools", group: "example_group", messageId: 99 })).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("refuses malformed chronology at the facade boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ ...context, contextKind: "complete_thread" })));
    await expect(watchApi.context("acme", { direction: "developer-tools", group: "example_group", messageId: 42 })).rejects.toBeInstanceOf(ApiFailure);
  });
});

describe("Watch membership and reading access", () => {
  it("keeps membership unknown when a legacy response only proves that public history is readable", () => {
    const html = renderGroups([group]);
    expect(html).toContain("Reading access");
    expect(html).toContain("Public history can be read.");
    expect(html).toContain("Membership");
    expect(html).toContain("Unknown");
    expect(html).toContain("Membership has not been confirmed.");
    expect(html).not.toContain("No membership action needed.");
    expect(html).not.toContain('aria-label="Join @example_group"');
    expect(membershipQueueLine(undefined)).toBeNull();
    expect(membershipTime(undefined)).toBeNull();
  });

  it("offers Join only when the server permits it, independently of a readable source", () => {
    const notMember = { ...group, membership: membership("not_member") };
    expect(renderGroups([notMember])).not.toContain('aria-label="Join @example_group"');
    const html = renderGroups([{ ...notMember, canJoin: true }]);
    expect(html).toContain('aria-label="Join @example_group"');
    expect(html).toContain("You can join this group.");
    expect(html).toContain("Public history can be read.");
    expect(membershipNext(notMember)).toBe("Joining is unavailable.");
  });

  it("shows account queue counts from the server and the group's next attempt, without another Join", () => {
    const queued = membership("queued", { queuedAt: "2026-11-27T10:00:00Z", nextAttemptAt: "2026-11-27T11:00:00Z" });
    const html = renderGroups([{ ...group, membership: queued }], {
      enabled: true, reason: null, dailyLimit: 5, usedToday: 3, queued: 12, nextJoinAt: "2026-11-27T11:00:00Z",
    });
    expect(html).toContain("Waiting for a queue slot.");
    expect(html).toContain("Next attempt");
    expect(html).toContain("Membership queue enabled");
    expect(html).toContain("12 groups queued");
    expect(html).toContain("3 of 5 joins used today");
    expect(html).toContain("next join");
    expect(html).not.toContain('aria-label="Join @example_group"');
  });

  it.each([
    ["joining", "Joining is in progress."],
    ["pending", "Wait for the group&#x27;s administrator."],
    ["manual_required", "Complete the check in Telegram."],
    ["refused", "No automatic retry."],
  ] as const)("shows the next action for %s and keeps the server reason visible", (state, next) => {
    const html = renderGroups([{ ...group, membership: membership(state, { reason: "Telegram requires a check." }) }]);
    expect(html).toContain(next);
    expect(html).toContain("Telegram requires a check.");
    expect(html).not.toContain('aria-label="Join @example_group"');
  });

  it("does not turn joined membership into proof of successful reading", () => {
    const html = renderGroups([{ ...group, access: "unknown", accessLine: "Read access has not been checked.", lastPolledAt: null,
      membership: membership("joined", { joinedAt: "2026-11-27T09:00:00Z" }) }]);
    expect(html).toContain("Read access has not been checked.");
    expect(html).toContain("Last read: ");
    expect(html).toContain("Not yet");
    expect(html).toContain("No membership action needed.");
    expect(html).not.toContain('aria-label="Join @example_group"');
  });

  it("reports a stopped queue and unscheduled work without inventing a retry time", () => {
    const line = membershipQueueLine({ enabled: false, reason: "Queue policy is off.", dailyLimit: 5, usedToday: 0, queued: 2, nextJoinAt: null });
    expect(line).toContain("Membership queue off");
    expect(line).toContain("2 groups queued");
    expect(line).toContain("next join not scheduled");
    expect(line).toContain("Queue policy is off.");
    expect(membershipTime(membership("unknown"))).toBeNull();
    expect(membershipTime(membership("queued", { queuedAt: "2026-11-27T10:00:00Z" }))).toContain("Queued");
    expect(membershipTime(membership("not_member", { checkedAt: "2026-11-27T10:00:00Z" }))).toContain("Checked");
  });

  it("keeps public discussion participants separate from private client conversations", () => {
    const client = new QueryClient();
    client.setQueryData(keys.watch("acme", "developer-tools", 30, null, null), { ...watch, people: [
      { author: "builder", moments: 1, intensitySum: 3, triggers: ["access"], groups: ["example_group"], lastAt: "2026-11-27T10:00:00Z" },
    ] });
    const html = render(<WatchView project="acme" q={search("view=people&direction=developer-tools")} />, client);
    expect(html).toContain("Public replies stay in their source discussion");
    expect(html).toContain("this list does not start private conversations");
    expect(html).not.toContain("never contacted from the Hub");
  });
});
