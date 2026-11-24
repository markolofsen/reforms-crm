import type { MessengerChannel } from "@hub/db";

declare const confirmedBrand: unique symbol;

/**
 * A reply the send door approved (`./door.ts`). The only value an adapter's `send` accepts. The brand makes it unforgeable in
 * types; the WeakSet makes it unforgeable at run time (a hand-built object, or one cast with `as`, is refused by `isConfirmed`).
 * `mintConfirmed` is not re-exported from any package entry: only `send-confirmed.ts` calls it.
 */
export interface ConfirmedDraft {
  readonly [confirmedBrand]: true;
  readonly state: "confirmed";
  readonly id: number;
  readonly project: string;
  readonly channel: MessengerChannel;
  readonly chatId: string;
  readonly text: string;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
}

const minted = new WeakSet<object>();

export function mintConfirmed(f: Omit<ConfirmedDraft, typeof confirmedBrand | "state">): ConfirmedDraft {
  const d = Object.freeze({ ...f, state: "confirmed" as const });
  minted.add(d);
  return d as unknown as ConfirmedDraft;
}

export function isConfirmed(x: unknown): x is ConfirmedDraft {
  return typeof x === "object" && x !== null && minted.has(x);
}
