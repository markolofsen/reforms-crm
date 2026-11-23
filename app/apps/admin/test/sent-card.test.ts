import { describe, expect, it } from "vitest";
import { sentLine, teammateLine } from "../src/features/mail/draft/card-state";
import { formatTime } from "../src/lib/format";

// P87 (B4): a sent draft's card says first that it went out, when and how.

describe("sentLine", () => {
  const at = "2026-11-20T12:06:45.000Z";
  it("names the send door's way, the time of the send, or Mail itself; nothing while the draft is not sent", () => {
    expect(sentLine({ status: "ready", sentAt: null, sendState: { id: 2, status: "sent", dueAt: null, via: "batch", doneAt: at } })).toBe(`Sent ${formatTime(at)} · Batch`);
    expect(sentLine({ status: "sent", sentAt: at, sendState: { id: 2, status: "sent", dueAt: null, via: "manual", doneAt: at } })).toBe(`Sent ${formatTime(at)} · By hand`);
    expect(sentLine({ status: "sent", sentAt: at, sendState: null })).toBe(`Sent ${formatTime(at)} · from Mail`);
    expect(sentLine({ status: "ready", sentAt: null, sendState: { id: 2, status: "queued", dueAt: at, via: "auto", doneAt: null } })).toBeNull();
  });
});

// P90: a teammate's reply in the thread (shared mailbox), else another person's Notion stamp, on an open draft only.
describe("teammateLine", () => {
  const at = "2026-11-20T14:02:00.000Z";
  const reply = { at, by: "Igor", messageId: "b1@x" };
  const stamp = { at, by: "Olga" };
  it("says who replied and that the draft may be out of date; the reply wins over the Notion stamp; nothing once sent", () => {
    expect(teammateLine({ status: "ready", repliedElsewhere: reply, teamSent: stamp })).toBe(`Igor replied at ${formatTime(at)} · your draft may be out of date`);
    expect(teammateLine({ status: "hold", repliedElsewhere: null, teamSent: stamp })).toBe(`Olga wrote to this client at ${formatTime(at)} (Notion) · your draft may be out of date`);
    expect(teammateLine({ status: "ready", repliedElsewhere: null, teamSent: null })).toBeNull();
    expect(teammateLine({ status: "sent", repliedElsewhere: reply, teamSent: stamp })).toBeNull();
  });
});
