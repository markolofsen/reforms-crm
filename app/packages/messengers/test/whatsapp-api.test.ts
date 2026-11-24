import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WAMessage } from "baileys";

// P141 W1: Baileys 7.0.0-rc14 message shapes as they reach `messages.upsert` (key, timestamp, pushName, content with its
// messageContextInfo), numbers and text replaced by synthetic ones. Each fixture names the exact hub message it must map to, or the
// reason it maps to none. Loading Baileys (protobufs, libsignal) takes seconds; no socket is built.

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/wa");
type Fixture = { note: string; message: WAMessage; expected: Record<string, unknown> | null; dropped?: string };
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f.replace(/\.json$/, ""), ...(JSON.parse(readFileSync(join(DIR, f), "utf8")) as Fixture) }));

describe("whatsapp-api: recorded Baileys shapes map to the exact hub message (P141 W1)", () => {
  it("has the shapes the plan names", () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(["button-reply", "edited", "ephemeral", "image-caption", "lid-without-alt", "link-preview", "link-preview-url-omitted", "pn-with-lid-alt", "reaction", "view-once"]);
  });

  it("each fixture maps to its expected message, or is dropped for its reason", async () => {
    const { mapBaileys } = await import("../src/whatsapp-api");
    for (const f of fixtures) {
      const r = mapBaileys(f.message);
      if (f.expected === null) {
        expect(r, f.name).toEqual({ dropped: f.dropped });
        continue;
      }
      expect("message" in r, f.name).toBe(true);
      const m = "message" in r ? r.message : null;
      expect({ ...m, at: m?.at.toISOString() }, f.name).toEqual(f.expected);
    }
  }, 60_000);

  it("a LID chat is never null: with its phone alias it is the phone's chat, without it lid:<digits>; the real address is the LID", async () => {
    const { chatIdOf, jidOf, realJidOf } = await import("../src/whatsapp-api");
    expect(chatIdOf("111122223333444@lid", "966500000001@s.whatsapp.net")).toBe("+966500000001");
    expect(chatIdOf("111122223333444@lid")).toBe("lid:111122223333444");
    expect(realJidOf("966500000001@s.whatsapp.net", "111122223333444@lid")).toBe("111122223333444@lid");
    expect(realJidOf("966500000001:7@s.whatsapp.net")).toBe("966500000001@s.whatsapp.net");
    // The request names the stored real address; without one, the address the chat id spells.
    expect(jidOf({ chatId: "+966500000001", jid: "111122223333444@lid" })).toBe("111122223333444@lid");
    expect(jidOf({ chatId: "+966500000001", jid: null })).toBe("966500000001@s.whatsapp.net");
    expect(jidOf({ chatId: "lid:111122223333444", jid: null })).toBe("111122223333444@lid");
  }, 60_000);

  it("groups, broadcasts and newsletters are not private; a key without an id has no chat", async () => {
    const { mapBaileys } = await import("../src/whatsapp-api");
    const at = 1_763_989_000;
    expect(mapBaileys({ key: { id: "G", remoteJid: "120363000000000000@g.us" }, message: { conversation: "x" }, messageTimestamp: at })).toEqual({ dropped: "not_private" });
    expect(mapBaileys({ key: { id: "N", remoteJid: "120363000000000000@newsletter" }, message: { conversation: "x" }, messageTimestamp: at })).toEqual({ dropped: "not_private" });
    expect(mapBaileys({ key: { remoteJid: "491510000002@s.whatsapp.net" }, message: { conversation: "x" }, messageTimestamp: at })).toEqual({ dropped: "no_chat_id" });
  }, 60_000);
});
