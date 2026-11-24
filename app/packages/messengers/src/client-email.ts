import { RepoError, type Repos } from "@hub/db";
import { assertHuman, type HumanActor } from "./human";
import { normalizeIdentifier } from "./normalize";

/**
 * P141 C4: the owner's "Add email…" on a client the Hub knows only by a chat. An address no other client has becomes this
 * client's Email (only into an empty one: the profile rule); an address another client already has merges this client into that
 * one (`repos.clients.merge`: its chats, drafts and history move, the old row keeps `merged_into`). A person's act only.
 */
export async function addClientEmail(repos: Repos, actor: HumanActor, input: { project: string; clientId: number; email: string }): Promise<{ clientId: number; merged: boolean }> {
  assertHuman(actor);
  const email = normalizeIdentifier("email", input.email);
  const client = await repos.clients.get(input.project, input.clientId);
  if (!client) throw new RepoError("not_found", `No client ${input.clientId} in project ${input.project}.`);
  if (client.email) throw new RepoError("wrong_state", `This client's Email is ${client.email} already; a second address goes to Other emails in Notion.`);
  const other = await repos.clients.findByIdentity(input.project, "email", email);
  if (other !== undefined && other !== client.id) {
    await repos.clients.merge(input.project, client.id, other, { by: actor.name });
    return { clientId: other, merged: true };
  }
  await repos.clients.setEmailIfEmpty(input.project, client.id, email);
  return { clientId: client.id, merged: false };
}
