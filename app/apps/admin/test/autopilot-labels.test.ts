import { describe, expect, it } from "vitest";
import type { AutopilotChatDto } from "@hub/contract/autopilot";
import { autopilotLine, autopilotMark, blockedWhy } from "../src/features/messengers/autopilot/chat-switch";
import { AUTOPILOT_RISK } from "../src/features/messengers/autopilot/settings";

// P139 A5: the autopilot's words on screen: why a chat's switch cannot be turned on, its state line, and the list's mark (a word,
// never only a colour).

const chat = (o: Partial<AutopilotChatDto> = {}): AutopilotChatDto => ({ chat: 1, channel: "telegram_user", chatId: "42", title: "Anna", listed: true, state: "on", off: null, pausedAt: null, pausedReason: null, pausedWords: null, note: null, ...o });

describe("the autopilot's words (P139 A5)", () => {
  it("says why the switch cannot be turned on: the Mac, the project, the reply mode, Stop sending", () => {
    expect(blockedWhy({ instanceOn: false, mode: "on" }, chat())).toBe("autopilot is off on this Mac");
    expect(blockedWhy({ instanceOn: true, mode: "off" }, chat())).toBe("autopilot is off for this project");
    expect(blockedWhy({ instanceOn: true, mode: "on" }, chat({ state: "off", off: "reply_mode" }))).toBe("needs the reply mode Draft");
    expect(blockedWhy({ instanceOn: true, mode: "on" }, chat({ state: "off", off: "stopped" }))).toBe("Stop sending is on");
    expect(blockedWhy({ instanceOn: true, mode: "dry_run" }, chat({ listed: false, state: "off", off: "chat" }))).toBeNull();
  });

  it("the state line names the mode, or the pause with its reason and the model's note", () => {
    expect(autopilotLine(chat())).toBe("Autopilot · answering");
    expect(autopilotLine(chat({ state: "dry_run" }))).toBe("Autopilot · dry run");
    expect(autopilotLine(chat({ state: "paused", pausedWords: "the assistant handed it back", note: "asked about a price", pausedAt: null }))).toBe("Autopilot · paused: the assistant handed it back (asked about a price)");
    expect(autopilotLine(chat({ listed: false, state: "off", off: "chat" }))).toBeNull();
  });

  it("the list's mark is a word: Autopilot, or Autopilot paused; nothing for a chat not switched on", () => {
    expect(autopilotMark(chat())).toBe("Autopilot");
    expect(autopilotMark(chat({ state: "paused" }))).toBe("Autopilot paused");
    expect(autopilotMark(chat({ listed: false, state: "off", off: "chat" }))).toBeNull();
    expect(autopilotMark(undefined)).toBeNull();
  });

  it("the Mac's switch says its risk once (verdict 27)", () => {
    expect(AUTOPILOT_RISK).toMatch(/without your click/);
    expect(AUTOPILOT_RISK).toMatch(/You accept that risk by switching it on/);
  });
});
