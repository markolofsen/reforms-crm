import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A project's send policy in a throwaway instance (P49 S11: `state/projects/<slug>/send-policy.json`, the server's file; a
 * `send:` or `draft.recipients` row in project.md is no longer read). Recipients any, drafts only: what the seeded flows expect.
 */
export function writeSendPolicy(home: string, slug: string): void {
  const dir = join(home, "state", "projects", slug);
  mkdirSync(dir, { recursive: true });
  const policy = { schema: 1, recipients: "any", mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10, updatedAt: "2026-11-18T00:00:00.000Z", by: "e2e" };
  writeFileSync(join(dir, "send-policy.json"), `${JSON.stringify(policy, null, 2)}\n`);
}
