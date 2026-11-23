import type { Repos } from "@hub/db";
import { lateSaves, recordAdoptions, type AdoptedVersion } from "../mail";
import type { ToolCtx } from "../mcp/ports";

/**
 * P65 S5 (decision 0031 addendum point 2): the thread's unrecorded drafts that are the Hub's own late saves become its
 * versions before a write, so the write replaces them. A Mail read that fails adopts nothing (the write goes on).
 */
export async function adoptLate({ repos, env }: ToolCtx, slug: string, draftId: number | null, mailRef: string, subject: string | null, versions: Awaited<ReturnType<Repos["mailVersions"]["ofDraft"]>>): Promise<AdoptedVersion[]> {
  if (!env.withRepos || !env.drafts || !env.projectMail) return [];
  // A database the server has not migrated yet (no `mail_writes`) adopts nothing rather than failing the write.
  const writes = await repos.mailWrites.ofThread(slug, mailRef, draftId).catch(() => []);
  const found = await lateSaves(env.drafts, { accounts: env.projectMail(slug).accounts, mailRef, subject, versions, writes }).catch(() => []);
  return found.length ? recordAdoptions(env.withRepos, slug, draftId, mailRef, found) : [];
}
