import { MAIL_SLOW_TEXT, writtenBody } from "./text";
import { DraftWriteError, type DraftWriter, type InboundMessage, type NewDraftInput, type ReplyDraftInput, type ReplyDraftResult, type ThreadMailDraft } from "./types";

// `@hub/mail-app/writer/fake` (architecture rule 3b: a fake behind its own subpath): the in-memory Mail of tests and of the server's fake switch.

/** In memory: what tests use. A write replaces exactly the versions it is told to, in the same account, as Mail does. */
export class FakeDraftWriter implements DraftWriter {
  /** `quote`: whether the real writer would have appended the quote of the original (`add`) or written the text verbatim (`keep`). */
  drafts: Array<{ id: number; messageId: string; account: string; thread: string; subject: string; text: string; quote: "add" | "keep"; /** The From the writer was asked for (P58), else the account. */ from?: string }> = [];
  private next = 1000;
  /** Inbound messages the fake Mail holds, by Message-ID. */
  inbound = new Map<string, InboundMessage>();
  /** Raw header blocks of the fake Mail's messages, by Mail's id. */
  headers = new Map<number, string>();
  /** Set: the next write is not seen in time (`mail_slow`); the draft is still saved, as Mail does late. */
  slowNext = false;
  constructor(private readonly threadOf: (messageId: number) => string = (id) => `m${id}@example.com`) {}
  async findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null> {
    const m = this.inbound.get(messageId.trim().replace(/^<|>$/g, ""));
    return m && accounts.includes(m.account) ? { ...m, accountAddresses: m.accountAddresses ?? this.addresses.get(m.account) ?? [m.account] } : null;
  }
  /** Texts of the fake Mail's messages, by Mail's id. */
  contents = new Map<number, string>();
  async readContent(m: InboundMessage): Promise<string> {
    const c = this.contents.get(m.messageId);
    if (c === undefined) throw new DraftWriteError("no_message", `No message ${m.messageId}.`);
    return c;
  }
  async readHeaders(m: InboundMessage): Promise<string> {
    const h = this.headers.get(m.messageId);
    if (h === undefined) throw new DraftWriteError("no_message", `No message ${m.messageId}.`);
    return h;
  }
  async messageIdOf(m: InboundMessage): Promise<string> {
    return this.threadOf(m.messageId);
  }
  /** Each account's own addresses (P58: what it can send as); absent: the account name alone, as Mail lists a one-address account. */
  addresses = new Map<string, string[]>();
  async addressesOf(account: string): Promise<string[]> {
    return this.addresses.get(account) ?? [account];
  }
  async threadDrafts(accounts: readonly string[], thread: string): Promise<ThreadMailDraft[]> {
    const t = thread.trim().replace(/^<|>$/g, "").toLowerCase();
    return this.drafts.filter((d) => accounts.includes(d.account) && d.thread.toLowerCase() === t).map((d) => ({ ref: String(d.id), messageId: d.messageId, account: d.account, body: d.text }));
  }
  async writeReply(i: ReplyDraftInput): Promise<ReplyDraftResult> {
    const body = writtenBody(i.body);
    if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
    const thread = this.threadOf(i.messageId);
    const subject = `Re: message ${i.messageId}`;
    const id = this.next++;
    const messageId = `draft-${id}@hub.test`;
    if (this.slowNext) {
      this.slowNext = false;
      this.drafts.push({ id, messageId, account: i.account, thread, subject, text: body, quote: i.quote ?? "add", from: i.sender ?? i.account });
      throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT, "");
    }
    const wanted = new Set((i.replace ?? []).map((x) => `${x.account}\u0000${x.messageId.toLowerCase()}`));
    const older = this.drafts.filter((d) => wanted.has(`${d.account}\u0000${d.messageId.toLowerCase()}`));
    this.drafts.push({ id, messageId, account: i.account, thread, subject, text: body, quote: i.quote ?? "add", from: i.sender ?? i.account });
    this.drafts = this.drafts.filter((d) => !older.includes(d));
    return { draftId: id, messageId, text: body, subject, thread, from: i.sender ?? i.account, replaced: older.map((d) => d.messageId), left: [], savedIn: i.account, shell: "" };
  }
  /** P85b: what the fake was asked for each new thread (the client's address). */
  newTo: string[] = [];
  async writeNew(i: NewDraftInput): Promise<ReplyDraftResult> {
    const body = writtenBody(i.body);
    if (!body.trim()) throw new DraftWriteError("empty", "The message has no text.");
    const id = this.next++;
    const messageId = `draft-${id}@hub.test`;
    const wanted = new Set((i.replace ?? []).map((x) => `${x.account}\u0000${x.messageId.toLowerCase()}`));
    const older = this.drafts.filter((d) => wanted.has(`${d.account}\u0000${d.messageId.toLowerCase()}`));
    this.newTo.push(i.to);
    this.drafts.push({ id, messageId, account: i.account, thread: "", subject: i.subject, text: body, quote: "keep", from: i.sender ?? i.account });
    this.drafts = this.drafts.filter((d) => !older.includes(d));
    return { draftId: id, messageId, text: body, subject: i.subject, thread: "", from: i.sender ?? i.account, replaced: older.map((d) => d.messageId), left: [], savedIn: i.account, shell: "" };
  }
}
