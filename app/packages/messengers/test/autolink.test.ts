import { describe, expect, it } from "vitest";
import { buildDirectory, e164, matchDialog, username, type DirectoryEntry } from "../src/autolink";
import { FakeMtClient, fakePerson } from "../src/fake-user";
import { FakeWaSocket } from "../src/fake-wa";
import { extractSignaturePhones } from "../src/signature-phones";
import { createTelegramUserAdapter } from "../src/telegram-user";
import { createWhatsAppAdapter } from "../src/whatsapp";
import { WaAuthFiles } from "../src/whatsapp-auth";

// P84: the autolink matcher, the signature extractor (built, not wired) and the adapters' identity-only hook. Pure or on fakes.

const entry = (key: string, o: Partial<DirectoryEntry> = {}): DirectoryEntry => ({ key, name: key, email: `${key}@example.test`, relationship: null, identifiers: [], ...o });

describe("autolink matcher", () => {
  const dir = buildDirectory([
    entry("anna", { identifiers: [{ kind: "phone", value: "+6281300001111" }, { kind: "username", value: "anna_s" }] }),
    entry("bob", { identifiers: [{ kind: "phone", value: "+6281300002222" }] }),
    entry("bobby", { identifiers: [{ kind: "phone", value: "+6281300002222" }] }),
    entry("carl", { email: null, identifiers: [{ kind: "phone", value: "+6281300003333" }] }),
  ]);

  it("one record is unique (P141 C1: with or without an email), two are ambiguous, nothing is none", () => {
    expect(matchDialog(dir, { chatId: "1", title: "x", phone: "+62 813-0000-1111", username: null })).toMatchObject({ kind: "unique", entry: { key: "anna" }, by: "phone" });
    expect(matchDialog(dir, { chatId: "2", title: "x", phone: "+6281300002222", username: null })).toMatchObject({ kind: "ambiguous", by: "phone" });
    expect(matchDialog(dir, { chatId: "3", title: "x", phone: "+6281300003333", username: null })).toMatchObject({ kind: "unique", entry: { key: "carl" }, by: "phone" });
    expect(matchDialog(dir, { chatId: "4", title: "x", phone: null, username: "@Anna_S" })).toMatchObject({ kind: "unique", by: "username" });
    expect(matchDialog(dir, { chatId: "5", title: "x", phone: "+15550000000", username: null })).toEqual({ kind: "none" });
  });

  it("a saved name never matches, and a number without its country code is not guessed", () => {
    expect(matchDialog(dir, { chatId: "6", title: "anna", phone: null, username: null })).toEqual({ kind: "none" });
    expect(matchDialog(dir, { chatId: "7", title: "x", phone: "081300001111", username: null })).toEqual({ kind: "none" });
    expect(e164("0062 813 0000 1111")).toBe("+6281300001111");
    expect(e164("813 0000 1111")).toBeNull();
    expect(username("https://t.me/Anna_S")).toBe("anna_s");
    expect(username("ab")).toBeNull();
    expect(username("t.me/Anna_S/")).toBe("anna_s");
    expect(username("@anna_s")).toBe("anna_s");
  });

  it("a WhatsApp number matches WhatsApp chats only, a Telegram number Telegram's, a Phone both, a username Telegram only", () => {
    const d = buildDirectory([
      entry("pat", { identifiers: [{ kind: "phone", value: "+6281300007777" }] }),
      entry("wanda", { identifiers: [{ kind: "phone", value: "+6281300008888", channel: "whatsapp" }] }),
      entry("tom", { identifiers: [{ kind: "phone", value: "+6281300009999", channel: "telegram" }, { kind: "username", value: "tom_t" }] }),
    ]);
    const dlg = (phone: string | null, user: string | null = null) => ({ chatId: "c", title: "x", phone, username: user });
    expect(matchDialog(d, dlg("+6281300007777"), "whatsapp")).toMatchObject({ kind: "unique", entry: { key: "pat" } });
    expect(matchDialog(d, dlg("+6281300007777"), "telegram")).toMatchObject({ kind: "unique", entry: { key: "pat" } });
    expect(matchDialog(d, dlg("+6281300008888"), "whatsapp")).toMatchObject({ kind: "unique", entry: { key: "wanda" } });
    expect(matchDialog(d, dlg("+6281300008888"), "telegram")).toEqual({ kind: "none" });
    expect(matchDialog(d, dlg("+6281300009999"), "telegram")).toMatchObject({ kind: "unique", entry: { key: "tom" } });
    expect(matchDialog(d, dlg("+6281300009999"), "whatsapp")).toEqual({ kind: "none" });
    expect(matchDialog(d, dlg(null, "Tom_T"), "telegram")).toMatchObject({ kind: "unique", by: "username" });
    expect(matchDialog(d, dlg(null, "tom_t"), "whatsapp")).toEqual({ kind: "none" });
    // One record with the same number in Phone and WhatsApp is still one record.
    const same = buildDirectory([entry("sam", { identifiers: [{ kind: "phone", value: "+6281300006666" }, { kind: "phone", value: "+6281300006666", channel: "whatsapp" }] })]);
    expect(matchDialog(same, dlg("+6281300006666"), "whatsapp")).toMatchObject({ kind: "unique", entry: { key: "sam" } });
  });
});

describe("signature phones (deterministic, not wired)", () => {
  it("reads the numbers of the signature with their country code, and skips quoted text and a reply header", () => {
    const mail = ["Hi, see the attached plan.", "Call me at +1 555 000 0000 if needed.", "", "Best regards,", "Anna Smith", "Tel: +62 813-0000-1111", "WhatsApp 0062 813 0000 2222", "Office 021 555 0000", "", "On Mon, Bob wrote:", "> +44 20 0000 0000"].join("\n");
    expect(extractSignaturePhones(mail)).toEqual(["+6281300001111", "+6281300002222"]);
  });
  it("without a sign-off it reads the last lines only", () => {
    const body = [...Array.from({ length: 20 }, (_, i) => `line ${i} +7 999 000 00 ${String(i).padStart(2, "0")}`), "Anna", "+7 (999) 111-22-33"].join("\n");
    expect(extractSignaturePhones(body)).toContain("+79991112233");
    expect(extractSignaturePhones(body)).not.toContain("+79990000000");
  });
});

describe("the adapters tell the matcher who wrote, never what", () => {
  it("Telegram: an unlinked inbound message gives the chat's id, name, phone and username, and is still dropped", async () => {
    const client = new FakeMtClient();
    const seen: unknown[] = [];
    const a = createTelegramUserAdapter({ client, account: "42", knownChats: async () => [{ chatId: "9", linked: true }], onUnlinked: (d, inbound) => seen.push({ ...d, inbound }) });
    await a.start?.();
    client.emit(fakePerson(7, "Anna", { phone: "6281300001111", username: "anna_s" }), "secret text");
    client.emit(fakePerson(7, "Anna", { phone: "6281300001111" }), "my own reply", { out: true });
    client.emit({ type: "other", id: -100, displayName: "Group" }, "group text");
    client.emit(fakePerson(9, "Linked"), "kept");
    expect(seen).toEqual([{ chatId: "7", title: "Anna", phone: "+6281300001111", username: "anna_s", inbound: true }]);
    const batch = await a.poll({ cursor: null, timeoutSec: 0, limit: 10 });
    expect(batch.messages.map((m) => m.text)).toEqual(["kept"]);
  });

  it("WhatsApp: an unlinked chat seen gives its number and name, and its text is not kept", async () => {
    const box: { sock: FakeWaSocket | null } = { sock: null };
    const seen: unknown[] = [];
    const a = createWhatsAppAdapter({
      socket: () => {
        const s = new FakeWaSocket(new WaAuthFiles(null));
        s.autoOpen = true;
        box.sock = s;
        return s;
      },
      account: "4915100000001",
      knownChats: async () => [],
      onUnlinked: (d, inbound) => seen.push({ ...d, inbound }),
    });
    await a.start?.();
    box.sock?.chat("+491519999999", "Stranger");
    box.sock?.message("+491519999999", "private text");
    expect(seen).toEqual([{ chatId: "+491519999999", title: "Stranger", phone: "+491519999999", username: null, inbound: true }]);
    expect(JSON.stringify(seen)).not.toMatch(/private text/);
    await a.close();
  });
});
