import type { QueryKey } from "@tanstack/react-query";
import type { LiveTopic } from "@hub/contract/live";

/**
 * The one query-key factory (`state-and-data.md` rule 2). A key names the resource first, then the project, then every
 * input that changes the reply, so a prefix (`["drafts", project]`) matches every view of one project's drafts.
 */
export const keys = {
  pulse: () => ["pulse"] as const,
  instance: () => ["instance"] as const,
  projects: () => ["projects"] as const,
  overview: () => ["overview"] as const,
  /** P63 O1: the Hub's parts (Overview's parts table): instance-wide, read from the server's own state. */
  scheme: () => ["scheme"] as const,
  /** P86: Overview's Recent errors, the newest error lines of the ops log. */
  opsErrors: () => ["ops-errors"] as const,
  connections: () => ["connections"] as const,
  /** P67: the instance's LaunchAgent (Connections, "This Mac"). */
  autostart: () => ["autostart"] as const,
  /** P68: the core update check (the sidebar's version line and the block on /health). */
  core: () => ["core"] as const,
  /** P72: the agent's live pointer (`GET /api/pointer`), refetched when the live topic `pointer` moves. */
  pointer: () => ["pointer"] as const,
  agentTools: (project: string) => ["agent-tools", project] as const,
  /** The agent activity feed (P59): the ended turns' tones and the wait, read from the session log on the server (P73: no rows). */
  agentFeed: (project: string) => ["agent-feed", project] as const,
  conversations: (project: string, view: string, batch: number | null, search: string, brand: string | null = null) => ["drafts", project, view, batch, search, brand] as const,
  /** P99: one conversation's header and unsent message (the Hub's rows): under `drafts`, so every topic that moves a row moves it. */
  conversation: (project: string, clientId: number) => ["drafts", project, "conversation", clientId] as const,
  /** P103: a client's key in the address to his row (under `drafts`, so a topic that moves a client refreshes it too). */
  clientKey: (project: string, key: string) => ["drafts", project, "client-key", key] as const,
  /** P99: one person's history read from Mail, and one body: Mail keys (read on open, on focus and on the `mail` topic). */
  conversationMail: (project: string, clientId: number) => ["conversation-mail", project, clientId] as const,
  conversationText: (project: string, clientId: number, messageId: string) => ["conversation-text", project, clientId, messageId] as const,
  batches: (project: string) => ["batches", project] as const,
  /** P85b: the run of Send all Checked of one batch (in the server's memory), polled while it runs. */
  batchRun: (project: string, batchId: number) => ["batch-run", project, batchId] as const,
  notByEmail: (project: string, kind: string | null) => ["not-by-email", project, kind] as const,
  /** P96: the Inbox view of Mail (the clients who wrote, from the server's Mail reader) and its reader line. */
  inbound: (project: string) => ["inbound", project] as const,
  /** P98: one Inbox message's state (open, drafts, the answering draft): under `inbound`, so the topics that refresh the list refresh it. */
  inboundItem: (project: string, id: number) => ["inbound", project, "item", id] as const,
  enrollments: (project: string, view: string) => ["enrollments", project, view] as const,
  /** P73: the timeline of one view, of one client or every one (`null`); its pages live under this key (an infinite query). */
  activity: (project: string, view: string, client: number | null) => ["activity", project, view, client ?? "every"] as const,
  timeline: (project: string, clientId: number) => ["timeline", project, clientId] as const,
  projectFacts: (project: string) => ["project", project] as const,
  links: (project: string) => ["links", project] as const,
  rules: (project: string) => ["rules", project] as const,
  /** P55: the project's agent model and advisor (Settings ▸ Agent); the same live topic as the safety rules. */
  agentSettings: (project: string) => ["agent-settings", project] as const,
  /** P70: the Knowledge table, per view and title search. */
  knowledge: (project: string, view: string, q: string) => ["knowledge", project, view, q] as const,
  knowledgeText: (project: string, key: string) => ["knowledge", project, "text", key] as const,
  sends: (project: string) => ["sends", project] as const,
  /** P71 M3: the Messengers panel's linked chats per view, and the owner's Telegram account (instance-wide, rides in health). */
  messengerChats: (project: string, view: string, link = "any", channel = "all", search = "") => ["messenger-chats", project, "list", view, link, channel, search] as const,
  /** Every list view of one project's panel; conversations and autolink have separate prefixes. */
  messengerChatsOf: (project: string) => ["messenger-chats", project, "list"] as const,
  messengerConversations: (project: string) => ["messenger-chats", project, "conversation"] as const,
  messengerConversation: (project: string, chatId: number) => ["messenger-chats", project, "conversation", chatId] as const,
  /** P84: the autolink's state (in memory on the server): under the panel's prefix, so a link or an unlink reads it again. */
  autolink: (project: string) => ["messenger-chats", project, "autolink"] as const,
  /** P102: one account's dialogs marked against a picked record (Link a chat…); under the autolink's prefix, so a link reads them again. */
  autolinkDialogs: (project: string, channel: string, account: string, key: string) => ["messenger-chats", project, "autolink", "dialogs", channel, account, key] as const,
  /** P84: a lookup of the Notion client records for one unlinked chat's Link (two or more characters). */
  autolinkRecords: (project: string, q: string) => ["messenger-chats", project, "autolink", "records", q] as const,
  telegramUser: () => ["telegram-user"] as const,
  /** P71 M5: the WhatsApp linked devices (instance-wide, ride in health), and one pairing's state while its QR code shows. */
  whatsapp: () => ["whatsapp"] as const,
  whatsappPairing: (flow: string) => ["whatsapp-pairing", flow] as const,
  /** Every pairing flow (P126 S1): the server bumps `connections` when a flow's step or QR moves. */
  whatsappPairings: () => ["whatsapp-pairing"] as const,
  doctor: (project: string) => ["doctor", project] as const,
  /** Reads of Mail (an `osascript` call each): the draft as Mail holds it, and a client's thread. */
  draftMail: (project: string, id: number) => ["draft-mail", project, id] as const,
  thread: (project: string, clientId: number) => ["thread", project, clientId] as const,
  /** P96: one client message's text read from Mail (the Inbox card): a Mail read, so on open and on focus only; its state is `inboundItem`. */
  inboundText: (project: string, id: number) => ["inbound-text", project, id] as const,
  /** P97: one lead's card (its Notion page read now). */
  lead: (project: string, pageId: string) => ["lead", project, pageId] as const,
  /** P134: one view of Mail ▸ Leads: under `inbound`, so every topic that moves the Leads group moves it. */
  leads: (project: string, view: string, brand: string | null) => ["inbound", project, "leads", view, brand] as const,
};

/**
 * The first part of the Mail keys: read on open and on focus (decision 0013). The one live event that reads Mail again is
 * `mail` (P53): the hub itself wrote a Mail draft of that project (`draft_write`), so the open card shows the new text.
 */
export const MAIL_KEYS: readonly string[] = ["draft-mail", "thread", "inbound-text", "conversation-mail", "conversation-text"];

/** One project's prefix of a resource, or every project's when the change is the instance's (`null`). */
const of = (resource: string) => (project: string | null): QueryKey => (project === null ? [resource] : [resource, project]);
const drafts = of("drafts");
const batches = of("batches");
const notByEmail = of("not-by-email");
const inbound = of("inbound");
const enrollments = of("enrollments");
const activity = of("activity");
const timeline = of("timeline");
const project = of("project");
const links = of("links");
const rules = of("rules");
const agentSettings = of("agent-settings");
const knowledge = of("knowledge");
const sends = of("sends");
const batchRun = of("batch-run");
const messengerChats = of("messenger-chats");
const agentTools = of("agent-tools");
const agentFeed = of("agent-feed");
const overview = () => keys.overview();
const scheme = () => keys.scheme();
const draftMail = of("draft-mail");
const thread = of("thread");
const conversationMail = of("conversation-mail");
const conversationText = of("conversation-text");

/**
 * What each live topic invalidates (P50). `tsc` fails when a topic is added without its keys. Only `mail` names a Mail key
 * (each read is an osascript call, so a row change never triggers one), and the doctor is read on open only: its checks are
 * not cheap and not rows.
 */
export const TOPIC_KEYS: Record<LiveTopic, (project: string | null) => QueryKey[]> = {
  drafts: (p) => [drafts(p), batches(p), timeline(p), project(p), overview(), inbound(p)],
  clients: (p) => [drafts(p), notByEmail(p), enrollments(p), timeline(p), overview()],
  activity: (p) => [activity(p), timeline(p), project(p), overview()],
  // P87: a send is a row of Activity ▸ All too (decision 0037 as amended).
  sends: (p) => [sends(p), batchRun(p), drafts(p), activity(p), timeline(p), project(p), overview(), scheme(), inbound(p)],
  inbox: (p) => [notByEmail(p), drafts(p), overview(), inbound(p)],
  "follow-ups": (p) => [enrollments(p), drafts(p)],
  batches: (p) => [batches(p), drafts(p)],
  rules: (p) => [rules(p), agentSettings(p), drafts(p), project(p)],
  projects: (p) => [keys.projects(), project(p), links(p), knowledge(p), agentTools(p), keys.connections(), overview(), scheme()],
  knowledge: (p) => [project(p), knowledge(p), scheme()],
  messengers: (p) => [messengerChats(p), drafts(p), notByEmail(p), project(p), keys.connections()],
  connections: () => [keys.connections(), keys.whatsappPairings(), agentTools(null), overview(), scheme()],
  health: (p) => [keys.pulse(), project(p), keys.connections(), keys.telegramUser(), keys.whatsapp(), overview(), scheme(), inbound(p)],
  mail: (p) => [draftMail(p), thread(p), conversationMail(p), conversationText(p)],
  "agent-log": (p) => [agentFeed(p)],
  autostart: () => [keys.autostart()],
  core: () => [keys.core(), scheme()],
  pointer: () => [keys.pointer()],
  "ops-log": () => [keys.opsErrors()],
};
