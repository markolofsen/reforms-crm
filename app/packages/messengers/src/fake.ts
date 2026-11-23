import type { MessengerChannel } from "@hub/db";
import { type AdapterError, type InboundMessage, type MessengerAdapter, type PollBatch, type PollOptions, type SendingAdapter, type SentReceipt } from "./adapter";
import { isConfirmed, type ConfirmedDraft } from "./confirmed";

type Pushed = Omit<InboundMessage, "channel" | "account" | "kind" | "sentAt"> & { kind?: string; sentAt?: string };

/** In-memory adapter for tests: scripted inbound messages, injectable failures, a log of what it was asked to send. */
export class FakeAdapter implements MessengerAdapter {
  readonly account = "fake-bot";
  started = 0;
  polls: (string | null)[] = []; // the cursor of every poll call
  failures: AdapterError[] = []; // thrown one per poll, first in first out
  private queue: { seq: number; msg: InboundMessage }[] = [];
  private seq = 0;

  constructor(readonly channel: MessengerChannel = "telegram_bot") {}

  /** Queue an inbound message; it is delivered once, then confirmed by advancing the cursor. */
  push(m: Pushed): void {
    this.queue.push({
      seq: ++this.seq,
      msg: { kind: "text", sentAt: new Date(Date.UTC(2026, 10, 14, 10, 0, this.seq)).toISOString(), ...m, channel: this.channel, account: this.account },
    });
  }

  async start(): Promise<void> {
    this.started++;
  }

  async poll(o: PollOptions): Promise<PollBatch> {
    this.polls.push(o.cursor);
    const f = this.failures.shift();
    if (f) throw f;
    const after = o.cursor ? Number(o.cursor) : 0;
    const due = this.queue.filter((q) => q.seq > after).slice(0, o.limit);
    return { messages: due.map((q) => q.msg), cursor: due.length ? String(due[due.length - 1]!.seq) : o.cursor };
  }
}

/** The fake with a `send`, for a sendable channel. `send` refuses anything `mintConfirmed` did not make. */
export class FakeSendingAdapter extends FakeAdapter implements SendingAdapter {
  declare readonly channel: "telegram_bot";
  sent: ConfirmedDraft[] = [];
  private nextId = 1000;

  constructor() {
    super("telegram_bot");
  }

  async send(draft: ConfirmedDraft): Promise<SentReceipt> {
    if (!isConfirmed(draft)) throw new Error("not_confirmed: send accepts only a ConfirmedDraft");
    this.sent.push(draft);
    return { remoteMessageId: String(this.nextId++), at: new Date(Date.UTC(2026, 10, 14, 12, 0, 0)).toISOString() };
  }
}
