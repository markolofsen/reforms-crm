import { describe, expect, it } from "vitest";
import { messengerPhrase, PREPARE_MAX, preparePhrase } from "../src/help";

describe("preparePhrase (P96 S2)", () => {
  it("one client: the triage-mail phrase naming the address and the subject", () => {
    expect(preparePhrase("lisbon", [{ email: "a@example.test", subject: "Re: Wow" }])).toBe("handle the mail from a@example.test (Re: Wow) in project lisbon");
  });
  it("several: one line naming each, one draft each; no line break or control character reaches the dock", () => {
    const line = preparePhrase("lisbon", [
      { email: "a@example.test", subject: "Line one\nline\u2028two" },
      { email: "b@example.test", subject: "" },
    ]);
    expect(line).toBe("handle the mail from a@example.test (Line one line two), b@example.test in project lisbon: one draft each");
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
  });
  it("names at most PREPARE_MAX clients", () => {
    const many = Array.from({ length: PREPARE_MAX + 5 }, (_, i) => ({ email: `c${i}@example.test`, subject: "" }));
    expect(preparePhrase("lisbon", many).match(/@example\.test/g)).toHaveLength(PREPARE_MAX);
  });
});

describe("messengerPhrase (P106 runtime handoff)", () => {
  it("names one linked chat instead of asking the agent to triage the whole project", () => {
    expect(messengerPhrase("reforms", { channel: "telegram_user", chatId: "1001", clientName: "Anna" })).toBe(
      "Prepare one reply for Anna from the telegram_user chat 1001 in project reforms. Read only this linked chat with messenger_history, then leave one unsent draft with messenger_draft_write; do not send anything.",
    );
  });
});
