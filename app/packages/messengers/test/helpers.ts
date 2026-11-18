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
