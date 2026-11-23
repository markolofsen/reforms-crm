import { formatTime } from "@/lib/format";
import { openResults, type ReviewDraft } from "../source";

/**
 * The 14 states of a review card (research 16 section 7 without `batch_waiting`, whose batch builder P48 deleted, and without
 * `batch` (P85: a batch draft is a Mail draft like any other), plus `follow_up` from P47; P105: without `confirming`, since Send
 * is confirmed in the review dialog, not in the bar). The action row is a pure function of one of these.
 */
export const CARD_STATES = [
  "checks_open",
  "unread",
  "acknowledged",
  "sending",
  "queued",
  "sent",
  "done",
  "skipped",
  "hold",
  "suspicious",
  "unreadable",
  "no_contact",
  "failed",
  "follow_up",
] as const;
export type CardState = (typeof CARD_STATES)[number];

/** Where the Send flow is, as far as the state needs it (the full flow lives in `use-send-flow`). */
export type FlowStep = "idle" | "reading" | "sending" | "refused" | "failed" | "sent";

/**
 * Which of the 15 states a draft is in. `follow_up` (P47) is an open step of a follow-up sequence: the hub refuses to send
 * it in every mode, so the way on is Mail, and the card's header carries Stop follow-ups. `readable` is false only when this server reads Mail and Mail has no such draft
 * (P27 M3.1): the text cannot be judged, so Checked and Send are off and the way on is Mail.
 */
export function stateOf(d: ReviewDraft, step: FlowStep, readable = true): CardState {
  if (d.sendState?.status === "queued") return "queued";
  if (d.sendState?.status === "sending" || step === "sending") return "sending";
  if (d.status === "sent" || d.sendState?.status === "sent") return "sent";
  if (d.status === "done") return "done";
  if (d.status === "skipped") return "skipped";
  if (d.status === "hold") return "hold";
  if (d.client.marks.includes("do_not_contact")) return "no_contact";
  if (d.injectionSuspected) return "suspicious";
  if (d.sequence) return "follow_up";
  if (step === "refused" || step === "failed") return "failed";
  if (!readable) return "unreadable";
  if (d.checked) return "acknowledged";
  return openResults(d).length > 0 ? "checks_open" : "unread";
}

export type PrimaryAction = "send" | "resume" | "open_mail";
/** The one primary. Send is never disabled (P105): it opens the review dialog, which names whatever stands in the way. */
export type Primary = { action: PrimaryAction; label: string; busy: boolean };
export type Secondary = "skip" | "open_mail" | "cancel_send" | "reopen";

/** `hasDraftLink` (P58 R1): the card's Mail read found the one draft, so Open goes to the draft itself; else to the client's message. */
export type Context = { name: string; hasMailLink: boolean; hasDraftLink: boolean };

/** P105 verdict 3: the draft opens by its own id; the client's message button says it is theirs. Same words as the local action registry. */
export const mailLabel = (c: Pick<Context, "hasMailLink" | "hasDraftLink">) => (c.hasDraftLink ? "Open the draft in Mail" : c.hasMailLink ? "Open their message" : "Copy subject to find in Mail");

/** The one primary button of a state, or null when the state has none. At most one, by construction. */
export function primaryFor(state: CardState, c: Context): Primary | null {
  switch (state) {
    case "checks_open":
    case "unread":
    case "acknowledged":
    case "failed":
      return { action: "send", label: "Send", busy: false };
    case "sending":
      return { action: "send", label: "Sending", busy: true };
    case "hold":
      return { action: "resume", label: "Resume", busy: false };
    case "suspicious":
    case "unreadable":
    case "no_contact":
    case "follow_up":
      return { action: "open_mail", label: mailLabel(c), busy: false };
    case "queued":
    case "sent":
    case "done":
    case "skipped":
      return null;
  }
}

/** The visible secondary buttons (two at most); everything else is in the More menu. */
export function secondaryFor(state: CardState): Secondary[] {
  switch (state) {
    case "checks_open":
    case "unread":
    case "acknowledged":
    case "failed":
      return ["skip", "open_mail"];
    case "queued":
      return ["cancel_send"];
    case "sent":
      return ["open_mail"];
    case "done":
    case "skipped":
      return ["reopen"];
    case "hold":
    case "suspicious":
    case "unreadable":
    case "no_contact":
    case "follow_up":
      return ["skip"];
    case "sending":
      return [];
  }
}

/** Whether Checked (accepted, for Send all Checked of a batch) can be set in this state: only while a send can follow. */
export const canCheck = (state: CardState): boolean => state === "checks_open" || state === "unread" || state === "acknowledged" || state === "failed";

const VIA = { batch: "Batch", manual: "By hand", auto: "Autosend" } as const;

/**
 * P87 (B4): a sent draft says first that it went out, when and how: "Sent 20 Nov, 20:06 · Batch" (the send door's row), or
 * "· from Mail" when Sent detection found it sent from Mail itself. Null while the draft is not sent.
 */
export function sentLine(d: Pick<ReviewDraft, "status" | "sentAt" | "sendState">): string | null {
  const door = d.sendState?.status === "sent" ? d.sendState : null;
  if (d.status !== "sent" && !door) return null;
  const at = d.sentAt ?? door?.doneAt ?? null;
  return `Sent${at ? ` ${formatTime(at)}` : ""} · ${door ? VIA[door.via] : "from Mail"}`;
}

/**
 * P90: what another person did that this open draft does not know: a reply in its thread that is not the Hub's ("Anna replied
 * at 20 Nov, 14:02 · your draft may be out of date"), else the client's Notion stamp by another person ("Anna wrote to this
 * client at 20 Nov, 14:02 (Notion) · …"). Null when neither, or the draft is sent. It informs; it never blocks a control.
 */
export function teammateLine(d: Pick<ReviewDraft, "status" | "repliedElsewhere" | "teamSent">): string | null {
  if (d.status === "sent") return null;
  if (d.repliedElsewhere) return `${d.repliedElsewhere.by} replied at ${formatTime(d.repliedElsewhere.at)} · your draft may be out of date`;
  if (d.teamSent) return `${d.teamSent.by} wrote to this client at ${formatTime(d.teamSent.at)} (Notion) · your draft may be out of date`;
  return null;
}
