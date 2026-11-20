import { describe, expect, it } from "vitest";
import { sentLine } from "../src/features/review/card/card-state";
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
