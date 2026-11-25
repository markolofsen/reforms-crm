import { createHash } from "node:crypto";
import { BATCH_SEND_ACTOR, BATCH_SEND_DAILY_CAP, BATCH_SEND_SPACING_SECONDS } from "@hub/config";
import { usageRefusal } from "@hub/db";
import { assess, type SendDeps } from "./assess";
import { sendDraft } from "./deliver";
import { mailHash } from "./find";

// Send all Checked of one batch (P85b, decision 0011 amendment of 2026-11-20 point 4). Not a bulk send: the same door as one
// click (`assess` and `sendDraft`, every guard), applied to each Checked draft of ONE batch in turn, after one confirmation that
// named each recipient and the exact text (its hash). Its own guards on top: a daily cap per project and a spacing between two
// mails, both counted from `send_log` (actor `admin-batch`). Nothing here runs on a timer or for the agent: the server's route
// starts a run only with a person's ticket, bound to the batch and to the drafts and hashes he confirmed.

export interface BatchLimits {
  dailyCap: number;
  spacingSeconds: number;
}
export const BATCH_LIMITS: Readonly<BatchLimits> = { dailyCap: BATCH_SEND_DAILY_CAP, spacingSeconds: BATCH_SEND_SPACING_SECONDS };

/** One Checked draft that would go out: exactly what the person confirms (recipients, subject) and the hash of the Mail text. */
export interface BatchItem {
  draftId: number;
  name: string;
  to: string[];
  cc: string[];
  subject: string;
  hash: string;
}
/** A Checked draft that would not go out now, with every reason in words. */
export interface BatchHeld {
  draftId: number;
  name: string;
  to: string[];
  subject: string;
  reasons: string[];
}
export interface BatchPlan {
  batchId: number;
  items: BatchItem[];
  held: BatchHeld[];
  /** This project's batch sends of the last 24 hours against the cap, and what is left. */
  cap: { limit: number; used: number; room: number };
  spacingSeconds: number;
}

/** What a run's ticket is bound to: the batch, and each confirmed draft with the hash of the text the person saw. */
export const batchTicketKey = (batchId: number, items: readonly Pick<BatchItem, "draftId" | "hash">[]): string =>
  `bsend:${batchId}:${createHash("sha256").update(JSON.stringify([...items].map((i) => [i.draftId, i.hash]).sort((a, b) => Number(a[0]) - Number(b[0])))).digest("hex")}`;

/**
 * The dry run of a batch send: every Checked draft of the batch through the door's `assess` (manual: the same refusals as one
 * click), read fresh from Mail. Sends nothing, writes nothing. Drafts past today's cap are held with that reason. Null when the
 * batch is not this project's.
 */
/** `only`: plan just these drafts of the batch (the lead review's click reads Mail only for what it sends; owner 2026-11-25). */
export async function planBatch(deps: SendDeps, project: string, batchId: number, limits: BatchLimits = BATCH_LIMITS, only?: readonly number[]): Promise<BatchPlan | null> {
  if (!(await deps.repos.batches.get(project, batchId))) return null;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const used = (await deps.repos.sends.actorUsage(project, BATCH_SEND_ACTOR, at)).sentLastDay;
  const room = Math.max(0, limits.dailyCap - used);
  const all = await deps.repos.batches.drafts(project, batchId, "checked");
  const checked = only ? all.filter((d) => only.includes(d.id)) : all;
  const items: BatchItem[] = [];
  const held: BatchHeld[] = [];
  for (const d of checked) {
    const name = d.client.name || d.client.email;
    const a = await assess(deps, d.id, { mode: "manual" });
    if (!a.ok || !a.mail) {
      held.push({ draftId: d.id, name, to: a.mail?.to ?? [d.client.email], subject: a.mail?.subject ?? d.subject, reasons: a.reasons });
      continue;
    }
    const m = a.mail;
    if (items.length >= room) {
      held.push({ draftId: d.id, name, to: m.to, subject: m.subject, reasons: [`over the batch cap: ${used} of ${limits.dailyCap} batch mails went out in the last 24 hours, ${room} left today`] });
      continue;
    }
    items.push({ draftId: d.id, name, to: m.to, cc: m.cc, subject: m.subject, hash: mailHash(m) });
  }
  return { batchId, items, held, cap: { limit: limits.dailyCap, used, room }, spacingSeconds: limits.spacingSeconds };
}

export type BatchItemStatus = "waiting" | "sending" | "sent" | "refused" | "failed" | "stopped";
export interface BatchOutcome {
  draftId: number;
  status: BatchItemStatus;
  reasons: string[];
  sendId: number | null;
  at: string | null;
}

export interface RunControl {
  /** True once the person pressed Stop: the items not yet tried are left, untouched, as `stopped`. */
  stopped(): boolean;
  /** Waits `ms`, or less when Stop is pressed meanwhile. */
  wait(ms: number): Promise<void>;
  /** Each change of one item, as it happens (the progress the admin shows). */
  update(o: BatchOutcome): void;
}

const parsed = (line: string): { sendId?: number; refused?: string[]; error?: string } => {
  try {
    return JSON.parse(line) as { sendId?: number; refused?: string[]; error?: string };
  } catch {
    return {};
  }
};

/** The run waits out the spacing this many times at most (each read of the log again), with this margin past the stated time. */
const SPACING_TRIES = 5;
const SPACING_MARGIN_MS = 250;

/**
 * One run, item by item, in the order confirmed. Before each mail: Stop of this run, the batch cap and the spacing (from
 * `send_log`, so two runs share them), the draft still in this batch, then the door itself (`sendDraft`: `assess` again,
 * Stop sending, do not contact, test-recipient mode, Checked bound to the text) and the hash the person confirmed. A refusal is
 * recorded and the run goes on; a transport failure stops it (P147); nothing is retried. Returns every outcome.
 */
export async function runBatch(deps: SendDeps, o: { project: string; batchId: number; items: readonly Pick<BatchItem, "draftId" | "to" | "subject" | "hash">[]; limits?: BatchLimits; control: RunControl }): Promise<BatchOutcome[]> {
  const limits = o.limits ?? BATCH_LIMITS;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const out: BatchOutcome[] = o.items.map((i) => ({ draftId: i.draftId, status: "waiting", reasons: [], sendId: null, at: null }));
  const set = (k: number, patch: Partial<BatchOutcome>) => {
    out[k] = { ...(out[k] as BatchOutcome), ...patch, at: now() };
    o.control.update(out[k] as BatchOutcome);
  };
  for (let k = 0; k < o.items.length; k++) {
    const item = o.items[k] as (typeof o.items)[number];
    if (o.control.stopped()) {
      for (let j = k; j < o.items.length; j++) set(j, { status: "stopped", reasons: ["not sent: you pressed Stop"] });
      break;
    }
    // The spacing and the cap, from the log: the last attempt of any batch run of this project, a failed one too.
    const u = await deps.repos.sends.actorUsage(o.project, BATCH_SEND_ACTOR, now());
    if (u.sentLastDay >= limits.dailyCap) {
      for (let j = k; j < o.items.length; j++) set(j, { status: "refused", reasons: [`the batch cap is reached: ${u.sentLastDay} of ${limits.dailyCap} batch mails in the last 24 hours`] });
      break;
    }
    // The spacing is the run's own pace, never a refusal: it waits until the log allows the next mail (a timer that fires a few
    // ms early, or a send row stamped after its mail left, read again and waited out), so the run never refuses its own item.
    let paced = true;
    for (let tries = 0; ; tries++) {
      const last = (await deps.repos.sends.actorUsage(o.project, BATCH_SEND_ACTOR, now())).lastAttemptAt;
      const ms = last ? new Date(last).getTime() + limits.spacingSeconds * 1000 - new Date(now()).getTime() : 0;
      if (ms <= 0) break;
      // A clock that never moves (it cannot happen on a real run): this item is held, never sent closer than the spacing.
      if (tries >= SPACING_TRIES) {
        paced = false;
        set(k, { status: "refused", reasons: [`the spacing did not pass after ${SPACING_TRIES} waits: send it again`] });
        break;
      }
      await o.control.wait(ms + SPACING_MARGIN_MS);
      if (o.control.stopped()) {
        paced = false;
        break;
      }
    }
    if (!paced) {
      if (o.control.stopped()) k--;
      continue;
    }
    const still = usageRefusal(await deps.repos.sends.actorUsage(o.project, BATCH_SEND_ACTOR, now()), { dailyCap: limits.dailyCap, spacingSeconds: 0 }, now());
    if (still) {
      set(k, { status: "refused", reasons: [still] });
      continue;
    }
    const d = await deps.repos.drafts.get(item.draftId);
    if (!d || d.project !== o.project || d.batchId !== o.batchId) {
      set(k, { status: "refused", reasons: ["the draft is no longer in this batch"] });
      continue;
    }
    // The text the person confirmed: a draft edited in Mail since the confirmation is not sent (it needs a new read and a new Checked).
    const a = await assess(deps, item.draftId, { mode: "manual" });
    if (a.ok && a.mail && mailHash(a.mail) !== item.hash) {
      set(k, { status: "refused", reasons: ["the draft changed in Mail after you confirmed the batch: read it again, tick Checked again and send it on its own"] });
      continue;
    }
    if (!a.ok || !a.mail) {
      set(k, { status: "refused", reasons: a.reasons });
      continue;
    }
    set(k, { status: "sending" });
    const r = await sendDraft(deps, { draftId: item.draftId, apply: true, actor: BATCH_SEND_ACTOR, confirm: { to: item.to, subject: item.subject } });
    const p = parsed(r.line);
    if (r.code === 0) set(k, { status: "sent", sendId: p.sendId ?? null });
    else if (r.code === 2) set(k, { status: "refused", reasons: p.refused ?? [p.error ?? "refused"] });
    else {
      // P147 verdict 7 (decision 0055 point 6): a transport failure (Mail broken or not answering) stops the run. The rest are
      // left untouched as `stopped`; a refusal of one draft (code 2) goes on. Resume sends the rest; an unknown one is refused by
      // `assess` (its row stays `sending`), so it is never sent twice.
      const reason = p.error ?? "the send failed";
      set(k, { status: "failed", reasons: [reason], sendId: p.sendId ?? null });
      const sent = out.filter((x) => x.status === "sent").length;
      for (let j = k + 1; j < o.items.length; j++) set(j, { status: "stopped", reasons: [`Stopped after ${sent} of ${o.items.length}: ${reason}; Resume`] });
      break;
    }
  }
  return out;
}
