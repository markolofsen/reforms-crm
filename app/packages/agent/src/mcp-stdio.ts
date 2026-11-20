import { hubPaths } from "@hub/config/paths";
import { bumpTopicIn, createRepos, openDb, openDbReadOnly } from "@hub/db";
import { loadProject } from "@hub/projects";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { mailAppDraftWriter } from "./mail-drafts";
import { createHubMcpServer, type VersionRecord } from "./mcp";
import type { WithRepos } from "./write-record";

/**
 * `hub mcp`: the hub's MCP server on stdio (P51, P52). Env: `HUB_HOME`, `HUB_PROJECT` (every tool refuses without it),
 * `HUB_DB` optional. The database is opened read-only (a `draft_write` bumps the live counter, P53, records the Mail version it saved, P65, and records a revision of an open hub draft in place, each on its own short connection); the one Mail write is `draft_write` (an unsent draft, through Mail's
 * scripting from this process, outside the agent's sandbox). Nothing but the protocol may reach stdout.
 */
export async function serveHubMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
  const projectMail = (slug: string) => {
    const c = loadProject(paths.projects, slug).parsed.config;
    return { accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages } };
  };
  // A revision the writer saved is recorded in place on a short write connection, closed at once (the tools' handle stays read-only).
  const recordRevision = async (slug: string, draftId: number, r: { excerpt: string; wroteTo: string | null; brand: string | null }) => {
    const w = openDb(paths.db);
    try {
      return await createRepos(w.db).drafts.revised(slug, draftId, r);
    } finally {
      w.close();
    }
  };
  // P65: every Mail version the writer saved is recorded the same way (the Hub's authorship record, decision 0031).
  const recordVersion = async (slug: string, v: VersionRecord) => {
    const w = openDb(paths.db);
    try {
      const repos = createRepos(w.db);
      await repos.mailVersions.add({ project: slug, mailRef: v.mailRef, draftId: v.draftId, account: v.account, mailId: v.mailId, messageId: v.messageId, hash: v.hash, source: "agent", signatureFallback: v.signatureFallback });
      await repos.mailVersions.markTrashed(v.trashed);
    } finally {
      w.close();
    }
  };
  // P65 S5: the write record and the adoption of late saves, on the same kind of short write connection.
  const withRepos: WithRepos = async (fn) => {
    const w = openDb(paths.db);
    try {
      return await fn(createRepos(w.db));
    } finally {
      w.close();
    }
  };
  const server = createHubMcpServer(createRepos(handle.db), { hubProject: env.HUB_PROJECT?.trim() || undefined, focusFile: paths.focus, pointerFile: paths.pointer, pointerWritten: (slug) => void bumpTopicIn(paths.db, "pointer", slug), drafts: mailAppDraftWriter(), projectMail, mailWritten: (slug) => void bumpTopicIn(paths.db, "mail", slug), recordRevision, recordVersion, withRepos });
  process.on("SIGINT", () => handle.close());
  await server.connect(new StdioServerTransport());
}
