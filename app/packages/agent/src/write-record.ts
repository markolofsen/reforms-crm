import { versionHashOf, type Adoption, type Repos } from "@hub/db";
import type { ThreadMailDraft, WriteLog } from "./mail-drafts";

// P65 S5 (decision 0031 addendum points 1 and 2): the Hub's record of the Mail writes it starts and of the late saves it
// adopts, over whatever write handle the caller has: `hub mcp` opens a short write connection per call (its tools' handle
// stays read-only) and the server pass their own repositories. Never the text: hashes only (0013).

/** Runs `fn` with repositories that may write. */
export type WithRepos = <T>(fn: (repos: Repos) => Promise<T>) => Promise<T>;

/** The write record of one hub draft (or of a new reply, `draftId` null) in one thread. */
export function writeLogOf(withRepos: WithRepos, project: string, draftId: number | null, mailRef: string): WriteLog {
  return {
    start: (text) => withRepos((r) => r.mailWrites.start({ project, mailRef, draftId, text })),
    settle: (id, saved) => withRepos((r) => r.mailWrites.settle(id, saved)),
    shell: (id, text) => withRepos((r) => r.mailWrites.shell(id, text)),
  };
}

/** A version the Hub adopted: its row and where it sits. */
export interface AdoptedVersion {
  id: number;
  account: string;
  messageId: string;
  mailId: number;
  why: Adoption["why"];
}

/**
 * Records the adopted late saves as the Hub's versions of the draft (`adopted`) and settles the writes they came from.
 * A draft already recorded (same account and Message-ID) keeps its row.
 */
export async function recordAdoptions(withRepos: WithRepos, project: string, draftId: number | null, mailRef: string, found: readonly Adoption<ThreadMailDraft>[]): Promise<AdoptedVersion[]> {
  if (found.length === 0) return [];
  return withRepos(async (r) => {
    const out: AdoptedVersion[] = [];
    for (const a of found) {
      if (!a.draft.messageId || !a.draft.account) continue;
      const mailId = Number(a.draft.ref) || 0;
      const id = await r.mailVersions.add({ project, mailRef, draftId, account: a.draft.account, mailId, messageId: a.draft.messageId, hash: versionHashOf(a.draft.body), source: "adopted" });
      if (a.writeId !== null && a.why === "late_save") await r.mailWrites.settle(a.writeId, { mailId, messageId: a.draft.messageId });
      out.push({ id, account: a.draft.account, messageId: a.draft.messageId, mailId, why: a.why });
    }
    return out;
  });
}
