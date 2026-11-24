import { mintAuthorization, textHash, type SendAuthorization } from "../src/authorization";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";

export interface Env {
  handle: DbHandle;
  repos: Repos;
  clientId: number;
  close: () => void;
}

/** In-memory database with project "p" registered and one client in it. */
export async function setup(): Promise<Env> {
  const handle = openDb(":memory:");
  const repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "x" }], addresses: [] });
  const clientId = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  return { handle, repos, clientId, close: () => handle.close() };
}

/**
 * The door's authorization for a stored draft, as `applyMessenger` mints it after its assessment (P112 S2): for tests of the
 * confirm and the send below the door. The owner's click; bound to the row's text as it is now.
 */
export async function authorized(repos: Repos, project: string, draftId: number, account = "test"): Promise<SendAuthorization> {
  const d = await repos.messengers.getDraft(project, draftId);
  if (!d) throw new Error(`no draft ${draftId}`);
  return mintAuthorization({ authority: { kind: "owner_click", actor: "admin" }, project, draftId, channel: d.channel, chatId: d.chatId, account, textHash: textHash(d.text), policyGeneration: "test" });
}
