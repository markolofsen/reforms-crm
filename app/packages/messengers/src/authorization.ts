import { createHash } from "node:crypto";
import type { AGENT_WORD_SEND_ACTOR } from "@hub/config";
import type { AUTOPILOT_SEND_ACTOR } from "@hub/config/autopilot";
import type { MessengerChannel } from "@hub/db";
import { MessengersError } from "./errors";

// P112 S2: who may make a messenger send, and the one value that lets the send happen. Internal to the package: neither
// `./door` nor `./human` nor the index re-exports `mintAuthorization` or `assertAuthorized`; the door (`./door.ts`) mints, and
// the confirm and the send (`./send-confirmed.ts`) check. A `HumanActor` plays no part in a send any more: it is for linking.

/**
 * Who asks for a send, as the caller of the door states it (there is no default):
 * - `owner_click`: the owner's Send in the admin, after the dry run and with the admin's single-use ticket (the route took it);
 * - `owner_word` (decision 0046): the agent of an attended session on the owner's word, which the agent-send route found in the
 *   session log; `ownerWord` is that word's log reference (one send per word, `send_log.owner_word`).
 *
 * - `autopilot` (decision 0048, P139 A4): the server's messenger autopilot, in a chat whose three switches the owner turned on;
 *   `turn` is the turn's action id (P137), the one reference its `send_log` row spends, so one turn sends at most once. The
 *   audit stage holds it to its share of the account (`AUTOPILOT_ACCOUNT_SHARE` of the daily cap).
 * Every switch below is exhaustive, so a new member fails the typecheck until it is handled.
 */
export type MessengerAuthority =
  | { readonly kind: "owner_click"; readonly actor: "admin" }
  | { readonly kind: "owner_word"; readonly actor: typeof AGENT_WORD_SEND_ACTOR; readonly ownerWord: string }
  | { readonly kind: "autopilot"; readonly actor: typeof AUTOPILOT_SEND_ACTOR; readonly turn: string };

/** The `send_log.actor` (and the draft's `confirmed_by`) of an authority. */
export function actorOf(a: MessengerAuthority): string {
  switch (a.kind) {
    case "owner_click":
      return a.actor;
    case "owner_word":
      return a.actor;
    case "autopilot":
      return a.actor;
    default:
      return unreachable(a);
  }
}

/** The unique reference an authority spends on its `send_log` row (`owner_word`), or null. */
export function referenceOf(a: MessengerAuthority): string | null {
  switch (a.kind) {
    case "owner_click":
      return null;
    case "owner_word":
      return a.ownerWord;
    case "autopilot":
      return a.turn;
    default:
      return unreachable(a);
  }
}

function unreachable(a: never): never {
  throw new MessengersError("not_authorized", `not_authorized: unknown send authority ${JSON.stringify(a)}`);
}

/** The fingerprint a send is bound to: the exact text that goes out. */
export const textHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

declare const authorizedBrand: unique symbol;

/**
 * One send the door authorized: this draft of this project, to this chat on this account, with exactly this text (its hash),
 * judged under this send-policy generation. Frozen, and unforgeable at run time (a hand-built or cast object is refused).
 */
export interface SendAuthorization {
  readonly [authorizedBrand]: true;
  readonly authority: MessengerAuthority;
  readonly project: string;
  readonly draftId: number;
  readonly channel: MessengerChannel;
  readonly chatId: string;
  readonly account: string;
  readonly textHash: string;
  readonly policyGeneration: string;
}

const minted = new WeakSet<object>();

/** The door's only: called once the assessment and the caller's confirmation agree. */
export function mintAuthorization(f: Omit<SendAuthorization, typeof authorizedBrand>): SendAuthorization {
  const a = Object.freeze({ ...f });
  minted.add(a);
  return a as unknown as SendAuthorization;
}

/**
 * The check of the confirm and of the send: a minted authorization for exactly this row (project, draft, channel, chat) whose text
 * hash is the row's text. Throws `not_authorized` otherwise: the row changed after the door judged it, or the value is forged.
 */
export function assertAuthorized(a: unknown, row: { project: string; id: number; channel: MessengerChannel; chatId: string; text: string }): asserts a is SendAuthorization {
  if (typeof a !== "object" || a === null || !minted.has(a)) throw new MessengersError("not_authorized", "not_authorized: a messenger send needs the door's authorization");
  const s = a as SendAuthorization;
  if (s.project !== row.project || s.draftId !== row.id || s.channel !== row.channel || s.chatId !== row.chatId) {
    throw new MessengersError("not_authorized", `not_authorized: the authorization is for draft ${s.draftId} of ${s.project}, not draft ${row.id} of ${row.project}`);
  }
  if (s.textHash !== textHash(row.text)) throw new MessengersError("not_authorized", "not_authorized: the draft text changed after the door checked it");
}
