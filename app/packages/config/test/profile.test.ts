import { describe, expect, it } from "vitest";
import { betterValue, chatClientTitle, isRealName, plainName } from "../src/profile";

// P140 P1b: one write-precedence rule for the client profile.
describe("the client profile's write precedence", () => {
  it("a phone number, an address, a chat id or the channel placeholder is not a real name", () => {
    for (const n of ["", "  ", "+966544555430", "966 54 455 5430", "info@qemah.com", "lid:92753952953", "123456789", "WhatsApp +966544555430", "Telegram @anna_k"]) expect(isRealName(n)).toBe(false);
    for (const n of ["Ahmed", "Ahmed, Qimma Auctions", "Qimma Auctions", "Anna K."]) expect(isRealName(n)).toBe(true);
    expect(isRealName("info@qemah.com", "info@qemah.com")).toBe(false);
  });
  it("a title gives way only to a real name, and a real name never to a phone number or an address", () => {
    expect(betterValue("title", "+966544555430", "Ahmed, Qimma Auctions")).toBe("Ahmed, Qimma Auctions");
    expect(betterValue("title", "", "Ahmed")).toBe("Ahmed");
    expect(betterValue("title", "Ahmed", "+966544555430")).toBeNull();
    expect(betterValue("title", "Ahmed", "Ahmed, Qimma Auctions")).toBeNull();
    expect(betterValue("title", "info@qemah.com", "info@qemah.com")).toBeNull();
    // P141 C5: the channel placeholder takes the place of a bare number, never of a name or an address.
    expect(betterValue("title", "+966544555430", "WhatsApp +966544555430")).toBe("WhatsApp +966544555430");
    expect(betterValue("title", "Ahmed", "WhatsApp +966544555430")).toBeNull();
    expect(betterValue("title", "info@qemah.com", "WhatsApp +966544555430")).toBeNull();
    expect(betterValue("title", "WhatsApp +966544555430", "Ahmed")).toBe("Ahmed");
  });
  it("an Email is never cleared or replaced, and a filled phone is kept", () => {
    expect(betterValue("email", "", "Info@Qemah.com")).toBe("info@qemah.com");
    expect(betterValue("email", "info@qemah.com", "other@qemah.com")).toBeNull();
    expect(betterValue("email", "info@qemah.com", "")).toBeNull();
    expect(betterValue("phone", "+966544555430", "+966500000000")).toBeNull();
    expect(betterValue("whatsapp", "", "+966544555430")).toBe("+966544555430");
  });
  it("P143 N2: a number wrapped in direction marks and spaced with no-break characters is a number, not a name", () => {
    const marked = "\u202a+55\u00a044\u00a099920\u20119735\u202c";
    expect(plainName(marked)).toBe("+55 44 99920-9735");
    expect(isRealName(marked)).toBe(false);
    expect(isRealName("\u200eAhmed\u200f")).toBe(true);
    // The placeholder replaces it, and a real Notion title replaces either.
    expect(betterValue("title", marked, "WhatsApp +554499209735")).toBe("WhatsApp +554499209735");
    expect(betterValue("title", marked, "SMART FIPE")).toBe("SMART FIPE");
    expect(betterValue("title", marked, marked)).toBeNull();
    expect(betterValue("title", "Ahmed", marked)).toBeNull();
    expect(chatClientTitle({ channel: "whatsapp", name: marked, phone: "554499209735" })).toBe("WhatsApp +554499209735");
  });
  it("a chat-only client is titled by the person's name, else by the channel and its number or username, never the bare number", () => {
    expect(chatClientTitle({ channel: "whatsapp", name: "Ahmed", phone: "+966544555430" })).toBe("Ahmed");
    expect(chatClientTitle({ channel: "whatsapp", name: "+966544555430", phone: "+966544555430" })).toBe("WhatsApp +966544555430");
    expect(chatClientTitle({ channel: "whatsapp", chatId: "lid:123" })).toBe("WhatsApp (number hidden)");
    expect(chatClientTitle({ channel: "telegram", username: "@anna_k" })).toBe("Telegram @anna_k");
  });
});
