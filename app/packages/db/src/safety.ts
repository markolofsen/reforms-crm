import { DEFAULT_SAFETY_RULES, FINDING_KIND, SAFETY_KINDS, unresolvedMarkers, type DraftFinding, type Mark, type SafetyKind, type SafetyResult, type SafetyRule } from "@hub/config";

// The safety rules engine (doc 14). Pure: a draft, its client and the rules in, the results out. The rules are data
// (`DEFAULT_SAFETY_RULES`, overridden per project in the `safety_rules` table), so the owner edits them without code.

export type SafetyInput = {
  draft: { subject: string; toAddr: string; ccAddr: string | null; body: string; mailRef: string | null };
  client: { email: string; repliesOwed: boolean; marks: Mark[] };
  /** When another draft of this client was last marked done or sent, if ever. */
  lastClosedAt: string | null;
  /** Addresses that may appear in To/Cc besides the client's own (the project's own mailboxes). */
  knownAddresses?: string[];
  now: Date;
  /** The findings the draft record stored (P60: `fact-other-brand`); absent or empty, no finding rule fires. */
  findings?: readonly DraftFinding[] | null;
  /** P65 S2: the language the newest Mail version the Hub wrote had no sign-off or signature line for (it was signed in English). */
  signatureFallback?: string | null;
};

const split = (v: string | null) =>
  (v ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rules to run: the defaults, each replaced by the project's row when there is one. */
export function effectiveRules(overrides: SafetyRule[] = []): SafetyRule[] {
  const byKind = new Map(overrides.map((r) => [r.kind, r]));
  return DEFAULT_SAFETY_RULES.map((d) => byKind.get(d.kind) ?? d);
}

export function evaluateSafety(input: SafetyInput, rules: SafetyRule[], acked: readonly string[] = []): SafetyResult[] {
  const { draft, client } = input;
  const out: SafetyResult[] = [];
  const text = `${draft.subject}\n${draft.body}`;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const fire = (kind: SafetyKind, message: string) =>
      out.push({ kind, level: rule.level, text: message, acked: acked.includes(kind) });
    switch (rule.kind) {
      case "do_not_contact":
        if (client.marks.includes("do_not_contact")) fire(rule.kind, "This client is marked do not contact. Do not send before the mark is lifted.");
        break;
      case "unresolved_marker": {
        const [marker] = unresolvedMarkers(text);
        if (marker) fire(rule.kind, `The text still has a placeholder: ${marker}. Fill it in or remove it.`);
        break;
      }
      case "cc_present": {
        const cc = split(draft.ccAddr);
        if (cc.length) fire(rule.kind, `Cc on this draft: ${cc.join(", ")}. Reply all also goes to them.`);
        break;
      }
      case "unknown_recipients": {
        // Cc has its own rule; this one is about who the mail is addressed to.
        const known = new Set([client.email.toLowerCase(), ...(input.knownAddresses ?? []).map((a) => a.toLowerCase())]);
        const to = split(draft.toAddr).filter((a) => !known.has(a));
        if (to.length) fire(rule.kind, `To is not the client's address: ${to.join(", ")}.`);
        break;
      }
      case "risky_word": {
        const hits = (rule.params.words ?? []).filter((w) => w.trim() && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w.trim())}(?![\\p{L}\\p{N}])`, "iu").test(text));
        if (hits.length) fire(rule.kind, `The draft mentions: ${hits.join(", ")}. Check it is meant to be said.`);
        break;
      }
      case "wrong_thread":
        if (client.repliesOwed && !draft.mailRef) fire(rule.kind, "They wrote last, but this draft is not tied to their thread. Reply in the thread, or send it as a new email on purpose.");
        break;
      case "signature_language":
        if (input.signatureFallback) fire(rule.kind, `The project has no sign-off or signature line for "${input.signatureFallback}", the client's language (P147 3f): the draft is signed in English. Edit the ending in that language, or add a ${input.signatureFallback}: line to signoff and the brand's Signature.`);
        break;
      case "already_sent_recently": {
        const days = rule.params.days ?? 7;
        if (input.lastClosedAt) {
          const age = (input.now.getTime() - new Date(input.lastClosedAt).getTime()) / 86_400_000;
          if (age >= 0 && age < days) fire(rule.kind, `A draft to this client was finished ${Math.max(0, Math.floor(age))} day(s) ago (rule: ${days} days).`);
        }
        break;
      }
      default: {
        // The record's findings: one result per kind, with the findings' own sentences.
        const own = (input.findings ?? []).filter((f) => FINDING_KIND[f.code] === rule.kind);
        if (own.length) fire(rule.kind, own.map((f) => f.text).join("; "));
      }
    }
  }
  return out;
}

/** True when every result that fired has been acknowledged. */
export const allAcknowledged = (results: SafetyResult[]) => results.every((r) => r.acked);

/**
 * The gate in front of Checked. A draft in a bulk batch needs every result acknowledged. A draft recorded by a session
 * holds only an excerpt of the mail, so the text rules cannot be trusted to be complete: only red results gate it
 * (owner decision recorded in P21), and amber ones are shown without blocking.
 */
export const blocksChecked = (results: SafetyResult[], inBatch: boolean) => results.some((r) => !r.acked && (inBatch || r.level === "red"));

export const isSafetyKind = (v: string): v is SafetyKind => (SAFETY_KINDS as readonly string[]).includes(v);
