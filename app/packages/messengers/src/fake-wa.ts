import { CREDS, type WaAuthFiles } from "./whatsapp-auth";
import type { WaAnchor, WaEvents, WaMe, WaMessage, WaSocket } from "./whatsapp";

/** A Boom-shaped error (what Baileys throws and closes with), for fakes and tests. */
export class FakeBoom extends Error {
  readonly output: { statusCode: number };
  constructor(statusCode: number, message = `Boom ${statusCode}`) {
    super(message);
    this.output = { statusCode };
  }
}

/**
 * A Baileys socket with no network, for tests (P71 M5): nothing here opens a WebSocket or reaches WhatsApp. It is built over an
 * auth store like the real one; `qr` plays a QR code, `scan` the phone's scan (it writes fake creds into the store, then reports
 * `paired`, then closes with 515 as Baileys does), `open` the opened connection, `closeWith` a close with its code, `message` a new
 * message, `history` a history batch, `chat` a chat's name. `sendText` records the text in `sent`; `sendError` makes it throw;
 * `historyAnswer` scripts the answer to `requestHistory`; `loggedOut` counts `logout`.
 */
export class FakeWaSocket implements WaSocket {
  closed = 0;
  loggedOut = 0;
  sent: { chatId: string; text: string; id: string }[] = [];
  sendError: unknown = null;
  historyRequests: { chatId: string; anchor: WaAnchor; count: number }[] = [];
  /** What the phone answers to `requestHistory`, per chat; nothing answers when absent. */
  historyAnswer = new Map<string, WaMessage[]>();
  /** A stored session opens by itself right after `listen`, as a real one does; a fresh store waits for `qr` and `scan`. */
  autoOpen: boolean;
  private events: WaEvents | null = null;
  private seq = 100;

  constructor(
    readonly auth: WaAuthFiles,
    readonly me: WaMe = { account: "4915100000001", name: "Owner" },
  ) {
    this.autoOpen = auth.get(CREDS) !== undefined;
  }

  listen(e: WaEvents): void {
    this.events = e;
    if (this.autoOpen) queueMicrotask(() => this.open());
  }
  get listening(): boolean {
    return this.events !== null;
  }
  qr(code = "2@fake-qr-reference,fake-noise-key,fake-identity-key,fake-adv-secret"): void {
    this.events?.connection({ state: "qr", qr: code });
  }
  /** The phone scans the code: the creds now name the account, then Baileys asks for a restart (515). */
  scan(): void {
    this.auth.set(CREDS, JSON.stringify({ me: { id: `${this.me.account}:7@s.whatsapp.net`, name: this.me.name }, registered: false, noiseKey: "fake-noise-key-material" }));
    this.auth.set("pre-key/1", JSON.stringify({ public: "fake-public", private: "fake-private" }));
    this.events?.connection({ state: "paired", me: this.me });
    this.closeWith(515);
  }
  open(): void {
    this.events?.connection({ state: "open", me: this.me });
  }
  closeWith(code: number | null = 428): void {
    this.events?.connection({ state: "close", code });
  }
  /** Plays one new message; returns it. */
  message(chatId: string, text: string, o: { fromMe?: boolean; kind?: string | null; id?: string; at?: Date } = {}): WaMessage {
    const m: WaMessage = { id: o.id ?? `3EB0FAKE${++this.seq}`, chatId, fromMe: o.fromMe ?? false, at: o.at ?? new Date("2026-11-20T10:00:00.000Z"), text, kind: o.kind === undefined ? "text" : o.kind };
    this.events?.messages([m], "live");
    return m;
  }
  history(ms: WaMessage[]): void {
    this.events?.messages(ms, "history");
  }
  chat(chatId: string, name: string): void {
    this.events?.chats([{ chatId, name }]);
  }
  async sendText(chatId: string, text: string): Promise<{ id: string; at: Date }> {
    if (this.sendError) throw this.sendError;
    const id = `3EB0SENT${++this.seq}`;
    this.sent.push({ chatId, text, id });
    return { id, at: new Date("2026-11-20T12:00:00.000Z") };
  }
  async requestHistory(chatId: string, anchor: WaAnchor, count: number): Promise<void> {
    this.historyRequests.push({ chatId, anchor, count });
    const answer = this.historyAnswer.get(chatId);
    if (answer) queueMicrotask(() => this.history(answer));
  }
  async logout(): Promise<void> {
    this.loggedOut++;
  }
  async close(): Promise<void> {
    this.closed++;
    this.events = null;
  }
}
