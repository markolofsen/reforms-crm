import type { Repos } from "@hub/db";
import type { Brand, ProjectConfig } from "@hub/projects/model";
import type { DraftWriter } from "@hub/mail-app/writer/types";
import type { WithRepos } from "../mail/write-log";
import type { ChatSortPort } from "../messenger/chat-sort-port";
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
   * Decision 0046: the server's agent send route (`messenger_send`). Passed only in an attended instance; absent, the tool does
   * not exist in this server (unattended sessions never see it).
   */
  agentSend?: AgentSendPort;
  /** P128 X5: the server's unlinked chats and the agent's proposed hides (loopback, the agent token); absent, both tools refuse `unavailable`. */
  chatSort?: ChatSortPort;
  /**
   * P129 A3 (decision 0045 point 10): where `draft_write` records a first draft and `client_record` a client handled without
   * one: the database, the project folders, the send policy and the ledger. Absent: both refuse `unavailable`.
   */
  records?: DraftRecordEnv;
  /**
   * P135 K5: copies a saved client map to the client's Notion page (the "Client map" code block and the "Map updated" date). Never
   * throws; its state is what `client_map` answers (`synced`, `skipped`, `off`, `failed`). Absent: the map stays in the Hub only.
   */
  syncClientMap?: (slug: string, m: { email: string; source: string; at: string }) => Promise<{ state: string }>;
  /** P129 verdict 7: whether these words are in one of this project's owner prompts of the last 12 hours (the P54 log). Absent: not checked. */
  ownerWords?: (slug: string, words: string) => boolean;
  /**
   * Decision 0048 (P139 A3, verdict 20): the one chat (its `messenger_chats` row id, `HUB_AUTOPILOT_CHAT`) an autopilot turn's
   * `hub mcp` serves. Set, the server registers only `AUTOPILOT_HUB_TOOLS`, every tool refuses another chat or client
   * (`autopilot_other_chat`), no owner words admit anything, and `messenger_draft_write` records the turn's verdict.
   */
  autopilotChat?: number;
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
