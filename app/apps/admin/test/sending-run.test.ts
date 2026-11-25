import { describe, expect, it } from "vitest";
import { runTitle, whoOf } from "../src/features/mail/ready/sending-line";

// P147 3m item 5 (owner 2026-11-25): the run's words at the top of Mail ▸ Sent and on the other lists' one line.

const item = (status: "waiting" | "sending" | "sent" | "failed") => ({ status }) as never;

describe("the run's words", () => {
  it("counts what went out", () => {
    expect(runTitle({ state: "running", items: [item("sent"), item("sent"), item("sending"), item("waiting")] })).toBe("Sending 2 of 4");
    expect(runTitle({ state: "finished", items: [item("sent"), item("failed")] })).toBe("Sent 1 of 2");
    expect(runTitle({ state: "stopped", items: [item("sent"), item("waiting")] })).toBe("Stopped: sent 1 of 2");
  });
  it("names a recipient once when the name is the address", () => {
    expect(whoOf({ name: "anna@example.test", to: ["anna@example.test"] })).toBe("anna@example.test");
    expect(whoOf({ name: "Anna", to: ["anna@example.test"] })).toBe("Anna · anna@example.test");
  });
});
