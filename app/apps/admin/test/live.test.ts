import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { describe, expect, expectTypeOf, it } from "vitest";
import { LIVE_TOPICS, type LiveEvent, type LiveTopic } from "@hub/contract/live";
import { applyLive, streamUrl } from "../src/lib/cache/live";
import { keys, MAIL_KEYS, TOPIC_KEYS } from "../src/lib/cache/keys";

// P50 L3: a live frame invalidates only the prefixes of its topic and project, never a Mail read.
const seed = () => {
  const qc = new QueryClient();
  const all = [keys.drafts("p", "ready", null, ""), keys.drafts("q", "ready", null, ""), keys.activity("p", "all"), keys.draftMail("p", 1), keys.thread("p", 2), keys.connections(), keys.pulse(), keys.overview(), keys.doctor("p")];
  for (const k of all) qc.setQueryData(k, 1);
  return qc;
};
const stale = (qc: QueryClient) => qc.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey.join("/"));

describe("TOPIC_KEYS", () => {
  it("covers every topic (a type and a run-time check); only mail names a Mail key, and only Mail keys", () => {
    expectTypeOf(TOPIC_KEYS).toEqualTypeOf<Record<LiveTopic, (project: string | null) => QueryKey[]>>();
    expect(Object.keys(TOPIC_KEYS).sort()).toEqual([...LIVE_TOPICS].sort());
    for (const t of LIVE_TOPICS) for (const p of ["p", null]) for (const k of TOPIC_KEYS[t](p)) expect(MAIL_KEYS.includes(String(k[0])), `${t}`).toBe(t === "mail");
  });
});

describe("applyLive", () => {
  it("a change invalidates only its topic's prefixes for its project", () => {
    const qc = seed();
    applyLive(qc, { type: "change", seq: 1, changes: [{ topic: "drafts", project: "p" }] }, false);
    expect(stale(qc).sort()).toEqual(["drafts/p/ready//", "overview"]);
  });
  it("mail re-reads only that project's Mail (P53: the hub wrote a draft)", () => {
    const qc = seed();
    applyLive(qc, { type: "change", seq: 1, changes: [{ topic: "mail", project: "p" }] }, false);
    expect(stale(qc).sort()).toEqual(["draft-mail/p/1", "thread/p/2"]);
  });
  it("an instance change reaches every project; Mail and the doctor stay", () => {
    const qc = seed();
    applyLive(qc, { type: "change", seq: 2, changes: [{ topic: "activity", project: null }, { topic: "connections", project: null }] }, false);
    expect(stale(qc).sort()).toEqual(["activity/p/all", "connections", "overview"]);
  });
  it("a reset refreshes everything but the pulse and Mail; a hello does nothing", () => {
    const qc = seed();
    applyLive(qc, { type: "hello", seq: 3, apiVersion: 9 }, false);
    expect(stale(qc)).toEqual([]);
    applyLive(qc, { type: "reset", seq: 3 }, false);
    expect(stale(qc).sort()).toEqual(["activity/p/all", "connections", "doctor/p", "drafts/p/ready//", "drafts/q/ready//", "overview"]);
  });
  it("a hidden tab only marks: a watched query refetches only when the tab is seen", async () => {
    const qc = seed();
    let calls = 0;
    const watched = new QueryObserver(qc, { queryKey: keys.connections(), queryFn: () => (calls += 1), staleTime: Infinity });
    const off = watched.subscribe(() => undefined);
    const frame: LiveEvent = { type: "change", seq: 4, changes: [{ topic: "connections", project: null }] };
    applyLive(qc, frame, true);
    await new Promise((r) => setTimeout(r, 0));
    expect([calls, stale(qc).includes("connections")]).toEqual([0, true]);
    applyLive(qc, frame, false);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    off();
  });
  it("a new stream resumes after the last frame this page applied", () => {
    expect(streamUrl(null)).toBe("/api/live");
    expect(streamUrl(7)).toBe("/api/live?since=7");
  });
});
