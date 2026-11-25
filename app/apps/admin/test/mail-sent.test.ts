import { describe, expect, it } from "vitest";
import type { SendRowDto } from "@hub/contract/sending";
import { sentRows } from "../src/features/mail/sent";

// P147 3m item 3: Mail ▸ Sent lists what went out (and the one going now), newest first; queued, failed and cancelled stay in Activity.

const s = (id: number, status: SendRowDto["status"], doneAt: string | null, channel: SendRowDto["channel"] = "mail") => ({ id, status, doneAt, createdAt: "2026-11-25T08:00:00.000Z", channel }) as SendRowDto;

describe("Mail ▸ Sent", () => {
  it("keeps the sends that went out, the one going now on top, then newest first, every channel", () => {
    const rows = sentRows([s(1, "sent", "2026-11-25T09:00:00.000Z"), s(2, "failed", "2026-11-25T10:00:00.000Z"), s(3, "sent", "2026-11-25T11:00:00.000Z", "whatsapp"), s(4, "queued", null), s(5, "cancelled", "2026-11-25T12:00:00.000Z"), s(6, "sending", null)]);
    expect(rows.map((r) => r.id)).toEqual([6, 3, 1]);
  });
});
