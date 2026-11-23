import { httpChatSort } from "../messenger/chat-sort-port";
import { hubPaths, instanceFeatures, instancePorts } from "@hub/config/paths";
import { bumpTopicIn, createRepos, openDb, openDbReadOnly } from "@hub/db";
import { createNotionReader, findClientByEmail, findLeadByEmail, loadToken, NoTokenError, secretsDir } from "@hub/notion";
import { join } from "node:path";
import { projectStore, readAllowList, testRecipientsOf } from "@hub/projects";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { mailAppDraftWriter } from "@hub/mail-app/writer";
import type { NotionClientCheck, RevisionRecord, VersionRecord } from "./ports";
import { createHubMcpServer } from "./server";
import type { WithRepos } from "../mail/write-log";
import { httpAgentSend } from "../messenger/send-tool";
import { readAgentSendToken } from "../messenger/send-token";
import { ownerWordsFound } from "../messenger/owner-word";
import { OWNER_WORD_MAX_AGE_HOURS } from "@hub/config";
import { logStoreOf, readEvents } from "@hub/log/store";

/**
 * `hub mcp`: the hub's MCP server on stdio (P51, P52). Env: `HUB_HOME`, `HUB_PROJECT` (every tool refuses without it),
 * `HUB_DB` optional. The database is opened read-only (the knowledge index too, P129 A4) (a `draft_write` bumps the live counter, P53, records the Mail version it saved, P65, and records a revision of an open hub draft in place, each on its own short connection); the one Mail write is `draft_write` (an unsent draft, through Mail's
 * scripting from this process, outside the agent's sandbox). Nothing but the protocol may reach stdout.
 */
export async function serveHubMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
  const projectMail = (slug: string) => {
    const c = projectStore({ projects: paths.projects }).config(slug);
    return { accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages }, messengers: c.messengers };
  };
  // P129 verdict 5: what `project_show` returns a slice of, with the send policy applied (read per call: it may change).
  const projectConfig = (slug: string) => projectStore({ projects: paths.projects, stateProjects: paths.stateProjects }).config(slug);
  // A revision the writer saved is recorded in place on a short write connection, closed at once (the tools' handle stays read-only).
  const recordRevision = async (slug: string, draftId: number, r: RevisionRecord) => {
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
  const leadRepos = createRepos(handle.db);
  // P87: a new thread's address is checked against the project's Notion Clients (read only, the project's token file).
  const clientInNotion = async (slug: string, email: string): Promise<NotionClientCheck> => {
    const cfg = projectStore({ projects: paths.projects }).config(slug);
    const ds = cfg.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) return { state: "unavailable", reason: "project.md lists no clients database (## Notion databases); fix it with the phrase of project-setup" };
    const file = cfg.notion.tokenFile;
    const token = await loadToken(file === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), file)).catch((e: unknown) => {
      if (e instanceof NoTokenError) return null;
      throw e;
    });
    if (token === null) return { state: "unavailable", reason: "the instance has no Notion token (Settings ▸ Connections)" };
    const reader = createNotionReader(token);
    const found = await findClientByEmail(reader, ds, email);
    if (found.state !== "not_client") return { state: found.state };
    // P97 S3 (decision 0044 point 2): a lead of the project's Notion Leads (Status not Spam) is a known person for a new thread:
    // the Hub's own Leads rows first (no Notion call), then the Leads data source.
    const stored = (await leadRepos.leadRows.ofEmail(slug, email)).find((r) => r.dismissedReason !== "spam" && r.notionStatus !== "Spam");
    if (stored) return { state: "lead", pageId: stored.pageId };
    const leads = cfg.notion.databases.find((d) => d.slug === "leads")?.dataSourceId;
    if (!leads) return { state: "not_client" };
    const lead = await findLeadByEmail(reader, leads, email);
    return lead.state === "lead" ? { state: "lead", pageId: lead.pageId } : { state: "not_client" };
  };
  // P92: the owner's test addresses while the project's send policy is test mode (read per call: the policy may change).
  const testRecipients = (slug: string) => testRecipientsOf(projectStore({ projects: paths.projects, stateProjects: paths.stateProjects }).config(slug), readAllowList(paths.configFile));
  // Decision 0046: `messenger_send` exists only in an attended instance (read at start; the server refuses an unattended one anyway).
  const attended = !instanceFeatures(paths).agent.unattended;
  const agentSend = attended ? { agentSend: httpAgentSend({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) }) } : {};
  // P128 X5: sorting the chats proposes hides only, so it is not gated on attendance.
  const chatSort = httpChatSort({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) });
  // P129 A3: draft_write and client_record record on their own short write connection (decision 0045 point 10).
  const records = { dbPath: paths.db, projectsDir: paths.projects, policyDir: paths.stateProjects, configFile: paths.configFile, ledgerRoot: env.HUB_LEDGER_ROOT ?? paths.home };
  // P129 verdict 7: the owner's words are looked up in this project's session log (the prompt hook writes every prompt).
  const ownerWords = (slug: string, words: string): boolean => {
    const now = new Date();
    const since = new Date(now.getTime() - OWNER_WORD_MAX_AGE_HOURS * 3_600_000).toISOString();
    return ownerWordsFound({ events: readEvents(logStoreOf(paths), { project: slug, kinds: ["prompt"], since }), words, now }).ok;
  };
  const server = createHubMcpServer(leadRepos, { ...agentSend, chatSort, records, ownerWords, clientInNotion, testRecipients, hubProject: env.HUB_PROJECT?.trim() || undefined, focusFile: paths.focus, pointerFile: paths.pointer, pointerWritten: (slug) => void bumpTopicIn(paths.db, "pointer", slug), drafts: mailAppDraftWriter(), projectMail, projectConfig, mailWritten: (slug) => void bumpTopicIn(paths.db, "mail", slug), recordRevision, recordVersion, withRepos });
  process.on("SIGINT", () => handle.close());
  await server.connect(new StdioServerTransport());
}
