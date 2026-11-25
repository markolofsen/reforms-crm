import { describe, expect, it } from "vitest";
import { runTitle, whoOf } from "../src/features/mail/ready/sending-line";

// P147 3m item 5 (owner 2026-11-25): the run's words at the top of Mail ▸ Sent and on the other lists' one line.

const item = (status: "waiting" | "sending" | "sent" | "failed") => ({ status }) as never;

describe("the run's words", () => {
  it("counts what went out", () => {
    expect(runTitle({ state: "running", items: [item("sent"), item("sent"), item("sending"), item("waiting")] })).toBe("Sending 2 of 4");
    expect(runTitle({ state: "finished", items: [item("sent"), item("sent")] })).toBe("Sent 2 of 2");
    expect(runTitle({ state: "stopped", items: [item("sent"), item("waiting")] }, [{ reason: "you pressed Stop" }])).toBe("Stopped: 1 sent, 1 not sent (you pressed Stop)");
  });
  it("says plainly what did not go out, with the reason, also after a restart (from the database, owner 2026-11-25)", () => {
    expect(runTitle({ state: "finished", items: [item("sent"), item("failed")] }, [{ reason: "the last send on this account was under 20 seconds ago: wait 1 s" }])).toBe("1 sent, 1 not sent (the last send on this account was under 20 seconds ago: wait 1 s)");
    expect(runTitle({ state: "finished", items: [item("sent"), item("failed"), item("failed")] }, [{ reason: "a" }, { reason: "b" }])).toBe("1 sent, 2 not sent");
    expect(runTitle(null, [{ reason: "confirmed, not sent yet" }])).toBe("1 not sent (confirmed, not sent yet)");
  });
  it("names a recipient once when the name is the address", () => {
    expect(whoOf({ name: "anna@example.test", to: ["anna@example.test"] })).toBe("anna@example.test");
    expect(whoOf({ name: "Anna", to: ["anna@example.test"] })).toBe("Anna · anna@example.test");
  });
});
