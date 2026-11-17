import { openResults, type ReviewDraft } from "../source";

/** The 16 states of a review card (research 16 section 7). The action bar is a pure function of one of these. */
export const CARD_STATES = [
  "checks_open",
  "unread",
  "acknowledged",
  "confirming",
  "sending",
  "queued",
  "sent",
  "done",
  "skipped",
  "hold",
  "suspicious",
  "unreadable",
  "batch",
  "no_contact",
  "failed",
  "batch_waiting",
] as const;
export type CardState = (typeof CARD_STATES)[number];

/** Where the Send flow is, as far as the state needs it (the full flow lives in `use-send-flow`). */
export type FlowStep = "idle" | "reading" | "confirm" | "sending" | "refused" | "failed" | "sent";

/**
 * Which of the 16 states a draft is in. `readable` is false only when this server reads Mail and Mail has no such draft
 * (P27 M3.1): the text cannot be judged, so Checked and Send are off and the way on is Mail. `batch_waiting` (a queued
 * batch, which has no draft yet) is not a state of a draft: `paneStateOf` names it for the pane of a batch.
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
  if (d.batchId !== null) return "batch";
  if (step === "confirm") return "confirming";
  if (step === "refused" || step === "failed") return "failed";
  if (!readable) return "unreadable";
  if (d.checked) return "acknowledged";
  return openResults(d).length > 0 ? "checks_open" : "unread";
}

/** The pane of a batch that no draft of has arrived in yet is state 16 (waiting for the agent); once one has, the card shows that draft. */
export const paneStateOf = (batch: { status: string; written: number }): CardState | null => (batch.status === "queued" && batch.written === 0 ? "batch_waiting" : null);

export type PrimaryAction = "send" | "confirm" | "resume" | "open_mail" | "reply_mail";
export type Primary = {
  action: PrimaryAction;
  label: string;
  enabled: boolean;
  /** Why it is disabled, in words (shown, and read by a screen reader). */
  reason: string | null;
  busy: boolean;
};
export type Secondary = "skip" | "open_mail" | "cancel" | "cancel_send" | "reopen";

export type Context = { name: string; hasMailLink: boolean; acknowledged: boolean };

const mailLabel = (c: Context) => (c.hasMailLink ? "Open in Mail" : "Copy subject to find in Mail");

/** The one primary button of a state, or null when the state has none. At most one, by construction. */
export function primaryFor(state: CardState, c: Context): Primary | null {
  const send = (enabled: boolean, reason: string | null): Primary => ({ action: "send", label: "Send", enabled, reason, busy: false });
  switch (state) {
    case "checks_open":
      return send(false, "Understand the checks first");
    case "unread":
      return send(false, "Turn on I read the checks");
    case "acknowledged":
    case "failed":
      return send(true, null);
    case "confirming":
      return { action: "confirm", label: `Send to ${c.name}`, enabled: true, reason: null, busy: false };
    case "sending":
      return { action: "confirm", label: `Send to ${c.name}`, enabled: false, reason: null, busy: true };
    case "hold":
      return { action: "resume", label: "Resume", enabled: true, reason: null, busy: false };
    case "suspicious":
    case "unreadable":
    case "no_contact":
      return { action: "open_mail", label: mailLabel(c), enabled: true, reason: null, busy: false };
    case "batch":
      return { action: "reply_mail", label: "Reply in Mail", enabled: c.acknowledged, reason: c.acknowledged ? null : "Turn on I read the checks", busy: false };
    case "queued":
    case "sent":
    case "done":
    case "skipped":
    case "batch_waiting":
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
    case "batch":
      return ["skip", "open_mail"];
    case "confirming":
      return ["cancel"];
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
      return ["skip"];
    case "sending":
    case "batch_waiting":
      return [];
  }
}

/** Whether the "I read the checks" switch is in the bar: only while there is something to acknowledge and send. */
export const hasSwitch = (state: CardState): boolean => state === "checks_open" || state === "unread" || state === "acknowledged" || state === "batch" || state === "failed";
