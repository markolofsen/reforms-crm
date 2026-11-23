import { ownSignoff, signatureLines, signingNames } from "@hub/projects/brand";
import { cut, ToolError } from "../mcp/result";
import type { DraftScope } from "./sign";

// The checks a new reply and a new thread share before Mail is asked (P65 S2, S5).

/** Open writes younger than this keep a new reply to the same message waiting (P65 S5: Mail took 74 s once). */
export const LANDING_MS = 10 * 60_000;

/**
 * P65 S2 (P60 finding 1): the writer signs, so the agent's own closing would be a second one. Refused, never edited.
 * Only where the writer signs at all (an identity with a sign-off or a Brands table).
 */
export function refuseOwnSignoff(s: DraftScope, content: string): void {
  if (!s.mail.identity || !(s.cfg.signoff.trim() || s.cfg.brands.length)) return;
  const own = ownSignoff(content, signatureLines(s.cfg), signingNames(s.cfg));
  if (own) throw new ToolError("own_signoff", `Your text ends with your own closing "${cut(own, 80)}": the hub signs every draft itself (the project's sign-off and the brand's signature). Remove that line (and any team or company name under it) and call draft_write again. Nothing was written.`);
}

/** A version of this thread the hub saved and has not recorded yet (no draft id), else undefined. */
export async function pendingVersion(s: DraftScope, mailRef: string) {
  return (await s.ctx.repos.mailVersions.ofThread(s.slug, mailRef)).find((v) => v.draftId === null && !v.trashedAt);
}

/** The hub's last write for this thread that may still be landing (Mail slow), else undefined. */
export async function landingWrite(s: DraftScope, mailRef: string) {
  return (await s.ctx.repos.mailWrites.ofThread(s.slug, mailRef).catch(() => [])).find((w) => !w.settledAt && w.draftId === null && Date.parse(w.startedAt) > s.ctx.now().getTime() - LANDING_MS);
}
