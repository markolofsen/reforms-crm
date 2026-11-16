import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { HistoryEntry, HistoryPage, HistoryQuery } from "@hub/mail";
import type { MailPages } from "../src/history";

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

export const mailEntry = (id: string, date: string, direction: "in" | "out" = "in"): HistoryEntry => ({
  id,
  date,
  direction,
  from: "anna@example.test",
  to: ["me@example.test"],
  cc: [],
  subject: `Subject ${id}`,
  mailbox: "INBOX",
  attachmentCount: 0,
  size: 100,
});

/** A mail reader over fixed entries per address, newest first, paged by an index cursor. Counts page calls. */
export class FakeMail implements MailPages {
  calls = 0;
  fail: { code: string } | null = null;
  constructor(private byAddress: Record<string, HistoryEntry[]>) {}
  async page(q: HistoryQuery): Promise<HistoryPage> {
    this.calls++;
    if (this.fail) throw Object.assign(new Error(this.fail.code), { code: this.fail.code });
    const all = [...(this.byAddress[q.address] ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    const start = q.cursor ? Number(q.cursor) : 0;
    const size = q.limit ?? 20;
    const entries = all.slice(start, start + size);
    const next = start + size;
    return { address: q.address, entries, total: all.length, ...(next < all.length ? { nextCursor: String(next) } : {}) };
  }
}
