import { httpLeadPass, httpMailJunk } from "../lead-pass/port";
import { httpChatSort } from "../messenger/chat-sort-port";
import { hubPaths, instancePorts } from "@hub/config/paths";
import { bumpTopicIn, createRepos, openDb, openDbReadOnly } from "@hub/db";
import { createNotionReader, findClientByEmail, findLeadByEmail, loadToken, NoTokenError, secretsDir } from "@hub/notion";
import { join } from "node:path";
import { checkClientMap, notionMapSource } from "@hub/diagram/map";
import { nextStepOf } from "@hub/diagram/map-status";
import { syncClientMap } from "@hub/notion/client-map";
import { syncFollowUp } from "@hub/notion/follow-ups";
import { fileBugReportFor } from "@hub/notion/bug-reports";
import { projectStore } from "@hub/projects/store";
import { readAllowList, testRecipientsOf } from "@hub/projects/guard";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { mailAppDraftWriter } from "@hub/mail-app/writer";
import type { FollowUpSync, NotionClientCheck, RevisionRecord, VersionRecord } from "./ports";
import { createHubMcpServer } from "./server";
import type { WithRepos } from "../mail/write-log";
import { httpAgentSend } from "../messenger/send-tool";
import { readAgentSendToken } from "../messenger/send-token";
import { ownerWordsFound } from "../messenger/owner-word";
import { OWNER_WORD_MAX_AGE_HOURS } from "@hub/config";
import { logStoreOf, readEvents } from "@hub/log/store";
import { ops } from "@hub/log/ops";
import { bindProject } from "./binding";
import { AUTOPILOT_CHAT_ENV } from "@hub/config/autopilot";
import { backgroundRunOf, bugNoteOf, FOLLOW_UP_BUG_NOTE_ENV, FOLLOW_UP_CLIENT_ENV } from "@hub/config/follow-ups";
import { LEAD_PAGE_ENV, LEAD_PASS_ENV, leadPageOf, MAIL_INBOUND_ENV, mailInboundOf } from "@hub/config/lead-pass";
import { coreChangedSince, toolsStamp } from "./core-stamp";
import { syncLeadDecision } from "@hub/notion/lead-decision";

/** Decision 0048 (verdict 20): the chat an autopilot turn's server is bound to (`HUB_AUTOPILOT_CHAT`, a row id), or none. */
export function autopilotChatOf(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env[AUTOPILOT_CHAT_ENV]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  // A value that is not a row id binds to no chat at all (0 matches no row), never to "every chat".
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Decision 0050 (P142 verdict 5): the client a sweep turn's server is bound to (`HUB_FOLLOWUP_CLIENT`, a row id), or none. */
export function followUpClientOf(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env[FOLLOW_UP_CLIENT_ENV]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Decision 0055 (P147 verdict 4): the lead a lead turn's server is bound to (`HUB_LEAD_PAGE`), or none; a malformed id binds to no lead. */
export const leadPageEnvOf = (env: NodeJS.ProcessEnv): string | undefined => leadPageOf(env[LEAD_PAGE_ENV]);
/** Decision 0055 point 9 (P147 3h): the inbound row a mail turn's server is bound to (`HUB_MAIL_INBOUND`), or none; malformed binds to none. */
export const mailInboundEnvOf = (env: NodeJS.ProcessEnv): number | undefined => mailInboundOf(env[MAIL_INBOUND_ENV]);
/** The turn's pass (`HUB_LEAD_PASS`, a `lead_passes` row id), or none. */
export function leadPassEnvOf(env: NodeJS.ProcessEnv): number | undefined {
  const n = Number(env[LEAD_PASS_ENV]?.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Decision 0046 (owner 2026-11-25): a session is attended when the owner started it (the dock, a terminal, a resumed session),
 * and unattended only when it is a background run the Hub started (an autopilot turn, a follow-up sweep turn: the runner sets
 * the variable). Never the permission mode: every session runs with no prompts and the OS sandbox on.
 */
export const attendedSession = (env: NodeJS.ProcessEnv): boolean => !backgroundRunOf(env) && autopilotChatOf(env) === undefined && followUpClientOf(env) === undefined && leadPageEnvOf(env) === undefined && mailInboundEnvOf(env) === undefined;

/** P142 F7: a plan to the client's Notion page (the four Hub properties and the dated line); its state is the tool's answer. */
const syncFollowUpOf = (paths: { projects: string; secrets: string }) => async (slug: string, f: FollowUpSync) =>
  syncFollowUp({ projectsDir: paths.projects, secretsDir: paths.secrets }, { project: slug, email: f.email, pageId: f.pageId, plan: { nextAt: f.nextAt, state: f.state, nudgeReady: f.nudgeReady, nudgesSent: f.nudgesSent, waitingOn: f.waitingOn, line: f.line } });

/**
 * `hub mcp`: the hub's MCP server on stdio (P51, P52). Env: `HUB_HOME`, `HUB_PROJECT` with `HUB_PROJECT_CAPABILITY` (P112 S3: the
 * launcher's capability for that slug, checked once here; without it every tool refuses as unbound),
 * `HUB_DB` optional. The database is opened read-only (the knowledge index too, P129 A4) (a `draft_write` bumps the live counter, P53, records the Mail version it saved, P65, and records a revision of an open hub draft in place, each on its own short connection); the one Mail write is `draft_write` (an unsent draft, through Mail's
 * scripting from this process, outside the agent's sandbox). Nothing but the protocol may reach stdout.
 */
export async function serveHubMcp(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const paths = hubPaths({ env });
  const handle = openDbReadOnly(paths.db);
  // P147 3j (5): the tools this process serves are the ones on disk now; a later edit or update makes it answer core_changed.
  const coreChanged = coreChangedSince(toolsStamp());
  const behind = handle.behind?.() ?? 0;
  if (behind > 0) ops("agent").warn("hub mcp opened a database behind this core: every tool refuses with db_behind until the Hub server restarts and migrates", { pending: behind });
  const projectMail = (slug: string) => {
    const c = projectStore({ projects: paths.projects }).config(slug);
    return { accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages }, messengers: c.messengers, booking: c.booking.url };
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
      await repos.mailVersions.add({ project: slug, mailRef: v.mailRef, draftId: v.draftId, account: v.account, mailId: v.mailId, messageId: v.messageId, hash: v.hash, source: "agent", signatureFallback: v.signatureFallback, brand: v.brand, wroteTo: v.wroteTo });
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
  // Decision 0048: an autopilot turn's server serves one chat, has no send port and no chat sort, attended instance or not.
  const autopilotChat = autopilotChatOf(env);
  // Decision 0050: a sweep turn's server serves one client, with no send port and no chat sort either.
  const followUpClient = followUpClientOf(env);
  // Decision 0055: a lead turn's server serves one lead, with no send port and no chat sort either.
  const leadPage = leadPageEnvOf(env);
  const leadPass = leadPassEnvOf(env);
  const mailInbound = mailInboundEnvOf(env);
  // Decision 0046: `messenger_send`, client_create and chat_link exist only in a session the owner started.
  const attended = attendedSession(env);
  const agentSend = attended ? { agentSend: httpAgentSend({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) }) } : {};
  // P128 X5: sorting the chats proposes hides only, so it is not gated on attendance.
  const chatSort = httpChatSort({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) });
  const leadPassRun = httpLeadPass({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) });
  const mailJunk = httpMailJunk({ port: () => instancePorts(paths, env).api, token: () => readAgentSendToken(paths) });
  // P129 A3: draft_write and client_record record on their own short write connection (decision 0045 point 10).
  const records = { dbPath: paths.db, projectsDir: paths.projects, policyDir: paths.stateProjects, configFile: paths.configFile };
  // P129 verdict 7: the owner's words are looked up in this project's session log (the prompt hook writes every prompt).
  const ownerWords = (slug: string, words: string): boolean => {
    const now = new Date();
    const since = new Date(now.getTime() - OWNER_WORD_MAX_AGE_HOURS * 3_600_000).toISOString();
    return ownerWordsFound({ events: readEvents(logStoreOf(paths), { project: slug, kinds: ["prompt"], since }), words, now }).ok;
  };
  // P135 K5: a new client map goes to the client's Notion page (its own section and "Map updated"), with the states' classDefs.
  // P136 verdict 5: the profile's Next step comes from the same map (its open leaf with the nearest date, else the first one).
  const syncMap = (slug: string, m: { email: string | null; pageId: string | null; source: string; at: string }) => {
    const g = checkClientMap(m.source, { sources: "optional" });
    return syncClientMap({ projectsDir: paths.projects, secretsDir: paths.secrets }, { project: slug, email: m.email, pageId: m.pageId, text: notionMapSource(m.source), at: m.at, nextStep: g.ok ? nextStepOf(g) : null });
  };
  // P112 S3: the slug binds only with its capability, once, for this process's life.
  const binding = bindProject(paths, env);
  if (binding.refusal) ops("agent").warn("hub mcp started unbound: HUB_PROJECT came without a valid project capability", { reason: binding.refusal });
  const server = createHubMcpServer(leadRepos, { syncClientMap: syncMap, ...agentSend, ...(autopilotChat !== undefined ? { autopilotChat } : followUpClient !== undefined ? { followUpClient, ...(bugNoteOf(env[FOLLOW_UP_BUG_NOTE_ENV]) !== undefined ? { bugNote: bugNoteOf(env[FOLLOW_UP_BUG_NOTE_ENV]) as number } : {}) } : leadPage !== undefined ? { leadPage, ...(leadPass !== undefined ? { leadPass } : {}) } : mailInbound !== undefined ? { mailInbound, ...(leadPass !== undefined ? { leadPass } : {}) } : { chatSort, leadPassRun, mailJunk }), syncFollowUp: syncFollowUpOf(paths), syncLeadDecision: (slug, d) => syncLeadDecision({ projectsDir: paths.projects, secretsDir: paths.secrets }, { project: slug, ...d }), fileBugReport: (slug, i) => fileBugReportFor({ projectsDir: paths.projects, secretsDir: paths.secrets }, slug, i), adminOrigin: () => { try { return `http://127.0.0.1:${instancePorts(paths, env).admin}`; } catch { return null; } }, records, ownerWords, clientInNotion, testRecipients, hubProject: binding.project, dbBehind: () => handle.behind?.() ?? 0, coreChanged, ...(binding.refusal ? { bindingRefusal: binding.refusal } : {}), focusFile: paths.focus, pointerFile: paths.pointer, pointerWritten: (slug) => void bumpTopicIn(paths.db, "pointer", slug), drafts: mailAppDraftWriter(), projectMail, projectConfig, mailWritten: (slug) => void bumpTopicIn(paths.db, "mail", slug), recordRevision, recordVersion, withRepos });
  process.on("SIGINT", () => handle.close());
  await server.connect(new StdioServerTransport());
}
