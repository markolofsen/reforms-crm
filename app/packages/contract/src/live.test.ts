import { describe, expect, it } from "vitest";
import { LIVE_TOPICS, liveTopic, parseLiveEvent } from "./live";

describe("live contract (P50)", () => {
  it("the three frames parse", () => {
    expect(parseLiveEvent(JSON.stringify({ type: "hello", seq: 3, apiVersion: 9 }))).toEqual({ type: "hello", seq: 3, apiVersion: 9 });
    expect(parseLiveEvent(JSON.stringify({ type: "change", seq: 4, changes: [{ topic: "drafts", project: "acme" }, { topic: "connections", project: null }] }))?.type).toBe("change");
    expect(parseLiveEvent(JSON.stringify({ type: "reset", seq: 4 }))).toEqual({ type: "reset", seq: 4 });
  });
  it("an unknown type, an unknown field or an unknown topic is refused", () => {
    expect(parseLiveEvent(JSON.stringify({ type: "data", seq: 1 }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: "reset", seq: 1, rows: [] }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: "change", seq: 1, changes: [{ topic: "mailbox", project: "a" }] }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: "change", seq: 1, changes: [{ topic: "drafts", project: "a", body: "x" }] }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: "change", seq: 1, changes: [] }))).toBeNull();
    expect(parseLiveEvent("not json")).toBeNull();
  });
  it("the topics are a closed list; mail is the hub's own Mail write (P53), agent-log the session log (P59), autostart the LaunchAgent (P67)", () => {
    expect(LIVE_TOPICS).toHaveLength(16);
    expect(liveTopic.safeParse("autostart").success).toBe(true);
    expect(liveTopic.safeParse("mail").success).toBe(true);
    expect(liveTopic.safeParse("mailbox").success).toBe(false);
  });
});
