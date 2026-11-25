import type { BugReportInput, BugReportResult } from "@hub/notion/bug-reports";
import { replyAddressOf } from "@hub/notion";
import type { LinkFetch } from "../link/fetch";
import type { Repos } from "@hub/db";
import type { Brand, ProjectConfig } from "@hub/projects/model";
import type { DraftWriter } from "@hub/mail-app/writer/types";
import type { WithRepos } from "../mail/write-log";
import type { ChatSortPort } from "../messenger/chat-sort-port";
import type { LeadPassPort } from "../lead-pass/port";
import type { AgentSendPort } from "../messenger/send-tool";
import type { DraftRecordEnv } from "../records/draft";
import { ToolError } from "./result";

// What `hub mcp`'s tools reach (P51, P52, P65, P82, P87, P92, P101, decision 0046), passed by `stdio.ts` or a test.

/** The bound project's Mail settings from `project.md` (`mail.accounts`, `mail.sender`), and what signs its drafts (P60). */
export interface ProjectMail {
  accounts: string[];
  sender: string | null;
  /** Addresses (with aliases), domains, sign-off, `## Brands` and `languages` (a reply outside them signed in English fires `signature_language`). Absent: drafts are written unsigned (tests of older shape). */
  identity?: { addresses: string[]; domains: string[]; signoff: string; brands: Brand[]; languages: string[] };
  /** Project-level Messenger defaults; per-chat non-null values override language/instruction. */
  messengers?: { language: string | null; instruction: string | null };
}

/** What the hub stores when its writer revised an open hub draft (coordinator 2026-11-19: no separate record step). */
export interface RevisionRecord {
  excerpt: string;
  wroteTo: string | null;
  brand: string | null;
  /** P99 S0 (c): a new "Why this email" line; absent, the recorded reason stays. */
  reason?: string;
}

export interface HubMcpEnv {
  /** The bound project (P112 S3: `HUB_PROJECT` with the launcher's capability, checked once at start); every tool refuses without it. */
  hubProject: string | undefined;
  /** Why `HUB_PROJECT` bound nothing (no capability, or another project's); absent: no project was named. */
  bindingRefusal?: string;
  /** P141 guard: how many migrations the database is behind this core (asked per call); above 0 every tool refuses with db_behind. */
  dbBehind?: () => number;
  /** P147 3j (5): whether the core's tool sources changed since this process started (asked per call); true, every tool refuses with core_changed. */
  coreChanged?: () => boolean;
  /** `link_fetch`'s fetcher (tests pass a fake); absent, the real public-only one. */
  linkFetch?: LinkFetch;
  /** `state/focus.json` of the instance. */
  focusFile: string;
  /** `state/pointer.json` of the instance (P72); absent, `highlight` refuses `unavailable`. */
  pointerFile?: string;
  /** Tells the open admin a pointer was written (the live topic `pointer`). A throw is reported, never fatal. */
  pointerWritten?: (slug: string) => void;
  now?: () => Date;
  /** Writes the reply drafts of `draft_write`; absent, the tool refuses. */
  drafts?: DraftWriter;
  /** The project's Mail accounts and sender; `draft_write` writes only from these accounts. */
  projectMail?: (slug: string) => ProjectMail;
  /**
   * P129 verdict 5: the project's resolved config (project.md with its send policy), what `project_show` returns a slice of
   * (P82 its Notion databases, P101 its Quick Links, P92 test mode). Absent, `project_show` refuses `unavailable`.
   */
  projectConfig?: (slug: string) => ProjectConfig;
  /**
   * Tells the open admin that a Mail draft of this project changed (P53: the live topic `mail`), so the card reads it
   * again. The database handle of the tools stays read-only; this writes only the live counter. A throw is reported, never fatal.
   */
  mailWritten?: (slug: string) => void;
  /** Records a revision of an open hub draft in place (same id, mailRef, client, context block). Absent: the revision is saved in Mail and not recorded. */
  recordRevision?: (slug: string, draftId: number, r: RevisionRecord) => Promise<{ draftId: number; action: string }>;
  /** Records the Mail version the writer saved (`mail_versions`) and marks the versions it replaced as trashed (P65). A throw is reported, never fatal. */
  recordVersion?: (slug: string, v: VersionRecord) => Promise<void>;
  /**
   * P65 S5: repositories that may write, for the write record (`mail_writes`, started before Mail is asked) and the
   * adoption of the Hub's own late saves. `hub mcp` opens a short connection per call. Absent: neither (older tests).
   */
  withRepos?: WithRepos;
  /**
   * P87: whether an address is a client in the project's Notion Clients data source (read only, the instance's Notion token).
   * `draft_write`'s new thread asks it for an address the project has not recorded; absent, such a new thread is refused
   * (`notion_unavailable`), since the rule "to a client of the project" is enforced here, not only in the tool's description.
   */
  clientInNotion?: (slug: string, email: string) => Promise<NotionClientCheck>;
  /**
   * P92: the owner's test addresses (the instance's allow_list) while the project's send policy is `draft.recipients: test`,
   * else none. A new thread to one of them passes without the Notion Clients check: they are exactly who a send may reach.
   */
  testRecipients?: (slug: string) => readonly string[];
  /**
   * Decision 0046: the server's agent send route (`messenger_send`). Passed only in a session the owner started; absent, the tool
   * does not exist in this server (a background run never sees it).
   */
  agentSend?: AgentSendPort;
  /** P128 X5: the server's unlinked chats and the agent's proposed hides (loopback, the agent token); absent, both tools refuse `unavailable`. */
  chatSort?: ChatSortPort;
  /** P147 F3: starts the server's lead pass from an attended session (`lead_pass_start`); absent in every background run. */
  leadPassRun?: LeadPassPort;
  /**
   * P129 A3 (decision 0045 point 10): where `draft_write` records a first draft and `client_record` a client handled without
   * one: the database, the project folders, the send policy and the ledger. Absent: both refuse `unavailable`.
   */
  records?: DraftRecordEnv;
  /**
   * P135 K5: copies a saved client map to the client's Notion page (the "Client map" code block and the "Map updated" date). Never
   * throws; its state is what `client_map` answers (`synced`, `skipped`, `off`, `failed`). Absent: the map stays in the Hub only.
   */
  syncClientMap?: (slug: string, m: { email: string | null; pageId: string | null; source: string; at: string }) => Promise<{ state: string }>;
  /** P129 verdict 7: whether these words are in one of this project's owner prompts of the last 12 hours (the P54 log). Absent: not checked. */
  ownerWords?: (slug: string, words: string) => boolean;
  /**
   * Decision 0048 (P139 A3, verdict 20): the one chat (its `messenger_chats` row id, `HUB_AUTOPILOT_CHAT`) an autopilot turn's
   * `hub mcp` serves. Set, the server registers only `AUTOPILOT_HUB_TOOLS`, every tool refuses another chat or client
   * (`autopilot_other_chat`), no owner words admit anything, and `messenger_draft_write` records the turn's verdict.
   */
  autopilotChat?: number;
  /**
   * Decision 0050 (P142 verdict 5): the one client (its `clients` row id, `HUB_FOLLOWUP_CLIENT`) a sweep turn's `hub mcp` serves.
   * Set, the server registers only `FOLLOW_UP_HUB_TOOLS`, every tool refuses another client (`followup_other_client`), and
   * `messenger_draft_write` may carry autopilot's verdict for a chat the server reads as an autopilot chat.
   */
  followUpClient?: number;
  /**
   * P142 F7: copies a plan to the client's Notion page (the four Hub properties, one dated line under "Follow-ups"). Never throws;
   * its state is what `follow_up_plan` answers. Absent: the plan stays in the Hub.
   */
  syncFollowUp?: (slug: string, f: FollowUpSync) => Promise<{ state: string }>;
  /**
   * Decision 0055 (P147 verdict 5, D2): the one lead (its normalised Notion page id, `HUB_LEAD_PAGE`) a lead pass turn's `hub mcp`
   * serves, and its pass (`HUB_LEAD_PASS`). Set, the server registers only `LEAD_PASS_HUB_TOOLS`; `draft_write` writes only a new
   * thread to the lead's reply address with the server's `owner_request`; `client_show` and `message_show` read only the client
   * whose email is exactly that address (`lead_other` otherwise).
   */
  leadPage?: string;
  leadPass?: number;
  /** P147: the Hub-owned decision and reason copied to the Leads page after `lead_decide`. Never throws; its state is the tool's answer. */
  syncLeadDecision?: (slug: string, d: { pageId: string; decision: string; reason: string }) => Promise<{ state: string }>;
  /**
   * P145 B3 (decision 0054): files one bug report in the project's Bug reports database (search, append or create). Never throws;
   * its state is what `bug_report` answers. Absent: the tool refuses `unavailable`.
   */
  fileBugReport?: (slug: string, i: BugReportInput) => Promise<BugReportResult>;
  /** The admin's origin (`http://127.0.0.1:<port>`), for a report's Source link; absent or null: no link. */
  adminOrigin?: () => string | null;
}

/** What the Notion copy of a plan needs (F7). */
export interface FollowUpSync {
  clientId: number;
  email: string | null;
  pageId: string | null;
  nextAt: string | null;
  state: "waiting" | "stopped" | "handed_over" | "answered";
  nudgeReady: boolean;
  nudgesSent: number;
  waitingOn: "them" | "us" | null;
  /** The dated line to append, or null (a same-day replace appends none: the page is append-only). */
  line: string | null;
}

export type NotionClientCheck = { state: "client" | "not_client" | "do_not_contact" } | { state: "lead"; pageId: string } | { state: "unavailable"; reason: string };

/** One Mail version `draft_write` saved, as the hub records it (P65): the identity, never the text. */
export interface VersionRecord {
  draftId: number | null;
  mailRef: string;
  account: string;
  mailId: number;
  messageId: string;
  hash: string;
  signatureFallback: string | null;
  /** P140 R3: the brand and the address the client wrote to that the signer resolved (the record of an adopted version takes them). */
  brand: string | null;
  wroteTo: string | null;
  /** Row ids of the recorded versions Mail moved to Trash in this write. */
  trashed: number[];
}

/** What every tool module gets: the read-only repositories, the env, and the two bindings every tool starts with. */
export interface ToolCtx {
  repos: Repos;
  env: HubMcpEnv;
  /** The bound slug, or the refusal `unbound`. */
  project: () => string;
  /** A draft of the bound project, or the refusal `not_found`. */
  ownDraft: (id: number) => Promise<{ slug: string; d: NonNullable<Awaited<ReturnType<Repos["drafts"]["get"]>>> }>;
  now: () => Date;
}

/**
 * Decision 0050 (verdict 5): in a follow-up turn every client a tool touches must be the turn's own; elsewhere it passes. `cid`
 * null (a thread or chat with no client) is another client too.
 */
export function ownFollowUpClient(env: HubMcpEnv, cid: number | null | undefined): void {
  if (env.followUpClient === undefined) return;
  if (cid !== env.followUpClient) throw new ToolError("followup_other_client", `This follow-up turn serves client ${env.followUpClient} only: nothing else is read or written here.`);
}

/** P147 (D2): the lead a lead turn serves, or the refusal `lead_other` when the binding names no stored lead. */
export async function boundLead(ctx: Pick<ToolCtx, "repos" | "env">, slug: string) {
  const page = ctx.env.leadPage;
  const row = page ? await ctx.repos.leadRows.get(slug, page) : null;
  if (!row) throw new ToolError("lead_other", `This lead turn is bound to lead ${page ?? "(none)"}, which project ${slug} does not hold: nothing is read or written here.`);
  return row;
}

/**
 * P147 D2: in a lead turn the one client a tool may read is the one whose email is exactly the lead's reply address; any other
 * match (phone, company domain, name) is the owner's (`hand_over`). Elsewhere it passes. `cid` null or undefined is another client.
 */
export async function ownLeadClient(ctx: Pick<ToolCtx, "repos" | "env">, slug: string, cid: number | null | undefined): Promise<void> {
  if (ctx.env.leadPage === undefined) return;
  const lead = await boundLead(ctx, slug);
  const to = replyAddressOf(lead).address; // E3: the address the reply goes to is the one that identifies the client
  const own = to ? await ctx.repos.clients.findByIdentity(slug, "email", to) : undefined;
  if (own === undefined || cid !== own) throw new ToolError("lead_other", `This lead turn reads only the client whose email is ${to ?? "the lead's (none)"}: another match is the owner's to judge (hand_over, "possible match").`);
}

export function toolCtx(repos: Repos, env: HubMcpEnv): ToolCtx {
  const project = (): string => {
    if (!env.hubProject) throw new ToolError("unbound", env.bindingRefusal ? `This session is not bound to a project: ${env.bindingRefusal}.` : "This session is not bound to a project (HUB_PROJECT): start it with `hub agent <project>`.");
    return env.hubProject;
  };
  const ownDraft = async (id: number) => {
    const slug = project();
    const d = await repos.drafts.get(id);
    if (!d || d.project !== slug) throw new ToolError("not_found", `No draft ${id} in project ${slug}.`);
    return { slug, d };
  };
  return { repos, env, project, ownDraft, now: () => env.now?.() ?? new Date() };
}

/** The slice of the project's config that `resolveBrand` and `signatureFor` read. */
export function configOf(m: ProjectMail): { mail: { accounts: string[]; addresses: string[]; domains: string[] }; signoff: string; brands: Brand[]; languages: string[] } {
  const id = m.identity ?? { addresses: [], domains: [], signoff: "", brands: [], languages: ["en"] };
  return { mail: { accounts: m.accounts, addresses: id.addresses, domains: id.domains }, signoff: id.signoff, brands: id.brands, languages: id.languages };
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
