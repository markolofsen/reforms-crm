import { CLIENT_FILTERS } from "@hub/config";
import { answeringDraft, type Repos } from "@hub/db";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { headersFromText, isOwnAddress, normalizeAddress, ownSignoff, replyLanguage, resolveBrand, signatureFor, signatureLines, signBody, signingNames, type Brand, type HeaderAddresses } from "@hub/projects";
import { POINTER_MAX_REFS, POINTER_NOTE_MAX, POINTER_TTL_MS } from "@hub/contract/pointer";
import { readFocus, resolveRef, writePointer } from "./focus";
import { cut, DATA, READ_ONLY, run, ToolError } from "./mcp-result";
import { MESSENGER_TOOLS, registerMessengerTools } from "./messenger/tools";
import { adviceOf, alreadySentText, draftFinishedText, DraftWriteError, fromFor, isNewThreadDraft, lateSaves, newThreadKey, reviseDraft, versionHash, writeRecorded, type DraftWriter, type InboundMessage, type Revision, type Signed } from "./mail-drafts";
import { recordAdoptions, writeLogOf, type AdoptedVersion, type WithRepos } from "./write-record";
import { projectNotion, type NotionScope } from "./notion-scope";

// `hub mcp` (P51, decision 0029): the hub's own stdio MCP server, bound to `HUB_PROJECT`. Five read-only tools: the admin's
// focus (refs resolved per kind, P72), one draft, one client, the Mail list, and the brand of an inbound from its headers (P60 `mail_brand`). The database is opened read-only by the caller (`openDbReadOnly`), so a
// write of a row is impossible, not just absent; the one exception is the live counter, bumped through `mailWritten`
// on a separate short connection (P53), which holds no row the owner sees. One Mail write (P52, decision 0030): `draft_write` saves an unsent reply in
// Mail's Drafts without a window or focus and moves the older versions the Hub recorded for that draft to Trash
// (`mail-drafts.ts`, decision 0031: by the `mail_versions` record, never by a line in the text); a revision names only the
// hub draft (P53), and the write bumps the live topic `mail` so the open card reads Mail again. No send. Every version
// it saves is recorded (`recordVersion`, a short write connection like `mailWritten`); a new reply to a message the
// project already has a draft or a version for is refused (`already_drafted`, P65 verdict 4).
// The writer signs (P60): sign-off plus the brand's Signature, resolved from the inbound's headers. A revision of a known hub
// draft is recorded by the hub itself (`recordRevision`, a short write connection like `mailWritten`); the first draft of a
// thread is still recorded by `hub record-draft` (decision 0009), which alone carries the evidence block. The tool names stay clear of `SEND_LIKE_TOOL`; a test pins the list.
// P71 M2: two messenger tools (`messenger/tools.ts`): `messenger_history` (read) and `messenger_draft_write` (a row in
// `messenger_drafts` on a short write connection, `withRepos`), linked chats only, bound by each chat's rules. No send tool.

// P72 (decision 0038): `highlight`, the pointer: up to five refs on the owner's screen get a ring for 30 s. It writes only
// `state/pointer.json` and bumps the live topic `pointer` (`pointerWritten`, a short connection like `mailWritten`); it never
// clicks, types, opens or navigates, and no tool of this server does.

// P82: `project_notion`, read only: the bound project's Notion databases by id (the same parse as the capabilities line).

export const HUB_MCP_TOOLS = ["focus", "highlight", "draft_show", "client_show", "inbound_show", "drafts_list", "mail_brand", "project_notion", "draft_write", ...MESSENGER_TOOLS] as const;

/** The bound project's Mail settings from `project.md` (`mail.accounts`, `mail.sender`), and what signs its drafts (P60). */
export interface ProjectMail {
  accounts: string[];
  sender: string | null;
  /** Addresses (with aliases), domains, sign-off, `## Brands` and `languages` (a reply outside them signed in English fires `signature_language`). Absent: drafts are written unsigned (tests of older shape). */
  identity?: { addresses: string[]; domains: string[]; signoff: string; brands: Brand[]; languages: string[] };
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
  /** The bound project; every tool refuses without it. */
  hubProject: string | undefined;
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
  /** P82: the project's Notion databases (`notionScopeOf` of its project.md); absent, `project_notion` refuses `unavailable`. */
  projectNotion?: (slug: string) => NotionScope;
  /**
   * Tells the open admin that a Mail draft of this project changed (P53: the live topic `mail`), so the card reads it
   * again. The database handle of the tools stays read-only; this writes only the live counter. A throw is reported, never fatal.
   */
  mailWritten?: (slug: string) => void;
  /** Records a revision of an open hub draft in place (same id, mailRef, client, context block). Absent: the result says to run `hub record-draft`. */
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
}

export type NotionClientCheck = { state: "client" | "not_client" | "do_not_contact" } | { state: "lead"; pageId: string } | { state: "unavailable"; reason: string };

/** Open writes younger than this keep a new reply to the same message waiting (P65 S5: Mail took 74 s once). */
const LANDING_MS = 10 * 60_000;

/** One Mail version `draft_write` saved, as the hub records it (P65): the identity, never the text. */
export interface VersionRecord {
  draftId: number | null;
  mailRef: string;
  account: string;
  mailId: number;
  messageId: string;
  hash: string;
  signatureFallback: string | null;
  /** Row ids of the recorded versions Mail moved to Trash in this write. */
  trashed: number[];
}

/**
 * The excerpt a revision keeps (decision 0013 point 3: a preview, never the body): at most 240 characters, its line breaks
 * kept (a poem stays a poem on the card), cut at a word with "…" when longer. P65 S5: it was whitespace-collapsed and cut
 * mid-word ("С теплом и дру").
 */
export const excerptOf = (body: string): string => {
  const t = body.replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= 240) return t;
  const head = t.slice(0, 239);
  const at = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  return `${(at > 160 ? head.slice(0, at) : head).trimEnd()}…`;
};

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function createHubMcpServer(repos: Repos, env: HubMcpEnv): McpServer {
  const server = new McpServer({ name: "hub", version: "0.1.0" });
  const project = (): string => {
    if (!env.hubProject) throw new ToolError("unbound", "This session is not bound to a project (HUB_PROJECT): start it with `hub agent <project>`.");
    return env.hubProject;
  };
  const ownDraft = async (id: number) => {
    const slug = project();
    const d = await repos.drafts.get(id);
    if (!d || d.project !== slug) throw new ToolError("not_found", `No draft ${id} in project ${slug}.`);
    return { slug, d };
  };
  /**
   * P65 S5 (decision 0031 addendum point 2): the thread's unrecorded drafts that are the Hub's own late saves become its
   * versions before a write, so the write replaces them. A Mail read that fails adopts nothing (the write goes on).
   */
  const adoptLate = async (slug: string, draftId: number | null, mailRef: string, subject: string | null, versions: Awaited<ReturnType<Repos["mailVersions"]["ofDraft"]>>): Promise<AdoptedVersion[]> => {
    if (!env.withRepos || !env.drafts || !env.projectMail) return [];
    // A database the server has not migrated yet (no `mail_writes`) adopts nothing rather than failing the write.
    const writes = await repos.mailWrites.ofThread(slug, mailRef, draftId).catch(() => []);
    const found = await lateSaves(env.drafts, { accounts: env.projectMail(slug).accounts, mailRef, subject, versions, writes }).catch(() => []);
    return found.length ? recordAdoptions(env.withRepos, slug, draftId, mailRef, found) : [];
  };

  server.registerTool(
    "focus",
    {
      title: "What the owner's admin shows",
      description: `What the owner sees in the Hub admin right now, for this project: the screen (route and title), \`subject\` (the record the address or the open card names), \`pointed\` (the row he clicked or arrowed to), \`selected\` (picked rows), \`window\` (the rows on screen and the list's total), the view and search, and the outcome of your last \`highlight\`. Each item is a ref (\`<kind>:<id>\`) with its title, status and \`read\`: the server, tool and arguments that read it (knowledge-mcp \`knowledge_get\` for an entry, \`draft_show\` for a draft). "этот клиент", "this draft", "эта запись", "вот это", "то, что выделено", "на что я смотрю" mean \`subject\`, else \`pointed\`, else the one selected or the one window item: read it with its \`read\` tool, never ask for a file name. Several on screen and none pointed: name the first few from \`window\` and the total, and ask which. "Do you see my page / screen?" is answered from it ("Да: Knowledge, запись <title>"), never with "I cannot see your screen" and never by offering browser automation. state: fresh (use it), stale (say the admin shows nothing current, ask), elsewhere (another project is open), none. ${DATA}`,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => run(async () => readFocus({ file: env.focusFile, slug: project(), repos, now: env.now?.() ?? new Date() })),
  );

  server.registerTool(
    "highlight",
    {
      title: "Point at rows on the owner's screen",
      description: `Draws a ring for ${POINTER_TTL_MS / 1000} s on up to ${POINTER_MAX_REFS} rows of the owner's admin ("покажи, где это", "show me"), with an optional note of at most ${POINTER_NOTE_MAX} characters shown as "Agent: <note>". \`refs\` are refs from \`focus\` (\`knowledge:...\`, \`draft:42\`); \`refs: []\` clears it. A pointer only: it never clicks, types, opens or navigates. A ref not on his screen is offered in the dock as "Agent points at ... · Show"; only his click goes there. Refused unless the focus is fresh, for a ref of another project or one that names nothing, and for more than ${POINTER_MAX_REFS}. The outcome (shown, not-on-screen, dismissed, expired) comes back in \`focus.pointer\` on his next move.`,
      inputSchema: z.object({
        refs: z.array(z.string()).max(POINTER_MAX_REFS).describe("Refs from focus, at most 5; [] clears the pointer."),
        note: z.string().max(POINTER_NOTE_MAX).optional().describe("A few words shown beside the ring, as text."),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ refs, note }) =>
      run(async () => {
        const slug = project();
        if (!env.pointerFile) throw new ToolError("unavailable", "The pointer is not available in this session.");
        const now = env.now?.() ?? new Date();
        if (refs.length) {
          const f = await readFocus({ file: env.focusFile, slug, repos, now, depth: "line" });
          if (f.state !== "fresh") throw new ToolError("not_looking", `The owner is not looking at ${slug}'s admin (focus ${f.state}): say it in words instead.`);
          const today = now.toISOString().slice(0, 10);
          for (const ref of refs) {
            if (!(await resolveRef({ repos, slug, today }, ref))) throw new ToolError("unknown_ref", `${cut(ref, 80)} names nothing in project ${slug}: use a ref from focus.`);
          }
        }
        const rec = writePointer(env.pointerFile, { project: slug, refs, note: note?.trim() ? note.trim() : null, now });
        let live = true;
        try {
          env.pointerWritten?.(slug);
        } catch {
          live = false;
        }
        return refs.length
          ? { id: rec.id, refs, note: rec.note, expiresInSeconds: POINTER_TTL_MS / 1000, live, next: "He sees a ring on each row on his screen; focus.pointer says whether he saw it." }
          : { id: rec.id, cleared: true, live };
      }),
  );

  server.registerTool(
    "draft_show",
    {
      title: "One draft of this project",
      description: `Status, recipients, the Mail key (mailRef: the Message-ID of the client's message this draft answers), the short excerpt, reason, marks, evidence, the recorded context, the Notion link, the follow-up step, the draft's Activity, \`inbound\` (account, mailbox_path, message_id of the client's message, for mail-mcp get_message_content), \`clientWroteTo\` (the project's address the client wrote to), \`fromSeenByClient\` (the From the hub writes this draft with, by its rule: the client sees exactly that, there is no hidden sender; the owner may still change it in Mail, and the admin card reads Mail's own) and \`fromReason\` (why it is not clientWroteTo, else null), \`repliedElsewhere\` (someone else, a teammate in a shared mailbox or the owner from another device, already answered this thread: who and when; the draft may be out of date: never write a second reply on your own, say so and revise only on the owner's word) and \`teamSent\` (another person wrote to this client per Notion's Last sent by). Not the body: it lives in Mail (\`mail\` names the Mail draft(s) the hub recorded for it: account and Message-ID; read the text with mail-mcp list_drafts / get_message_content). To revise it: \`draft_write\` with \`draft\` = this id (nothing else to look up); the revision records itself. A \`sent\` draft is not revised (\`already_sent\`). Never send. ${DATA}`,
      inputSchema: z.object({ draft: z.number().int().positive().describe("The draft id, as the focus or the admin shows it (the same name draft_write takes).") }),
      annotations: READ_ONLY,
    },
    ({ draft }) =>
      run(async () => {
        const { slug, d } = await ownDraft(draft);
        const c = await repos.clients.card(slug, d.clientId);
        // The message this draft answers, where mail-mcp can open it (P53): no hunting with find_messages. Null when not found.
        const pm = env.projectMail?.(slug);
        const inbound = d.mailRef && env.drafts && pm ? await env.drafts.findInbound(pm.accounts, d.mailRef).catch(() => null) : null;
        // P58: who the client sees the reply from, by the rule the writer applies (the receiving account and what it can send as).
        const rf = inbound && env.drafts && pm ? await fromFor(env.drafts, inbound, d.wroteTo ?? null, pm).catch(() => null) : null;
        const versions = await repos.mailVersions.ofDraft(d.id);
        const events = (await repos.runs.eventsForClient(slug, d.clientId, 100)).filter((e) => json<{ draftId?: number }>(e.detail, {}).draftId === d.id).slice(0, 20);
        const team = await repos.drafts.teamNotice(d.id);
        return {
          id: d.id,
          project: slug,
          status: d.status,
          subject: cut(d.subject, 300),
          to: d.toAddr,
          cc: d.ccAddr,
          mailRef: d.mailRef,
          excerpt: cut(d.body, 600),
          reason: d.reason,
          checked: d.checked,
          injectionSuspected: d.injectionSuspected,
          client: c ? { id: c.id, name: cut(c.name), email: c.email, marks: c.marks, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt } : null,
          evidence: d.evidence ? { level: d.evidence, source: d.evidenceSource, findings: json<unknown[]>(d.evidenceFindings, []), context: json<Record<string, unknown>>(d.context, {}) } : null,
          notion: d.notionUrl ? { kind: d.notionKind, url: d.notionUrl } : null,
          followUp: d.enrollmentId == null ? null : { enrollmentId: d.enrollmentId, step: d.sequenceStep },
          activity: events.map((e) => ({ at: e.at, kind: e.kind, summary: cut(e.summary, 200) })),
          body: `In Mail, not here: the draft to ${d.toAddr} with subject "${cut(d.subject, 200)}"${d.mailRef ? ` answering Message-ID ${d.mailRef}` : ""}.`,
          // The Mail versions the hub wrote for it (P65), newest first: how its text is found in Drafts without any line in it.
          mail: versions.filter((x) => !x.trashedAt).map((x) => ({ account: x.account, mail_id: x.mailId, message_id: x.messageId, written_at: x.writtenAt })),
          inbound: inbound ? { account: inbound.account, mailbox_path: inbound.mailboxPath, message_id: inbound.messageId } : null,
          clientWroteTo: d.wroteTo ?? null,
          // P90: someone else (a teammate in a shared mailbox, or the owner elsewhere) already answered this thread, or wrote to the client per Notion.
          repliedElsewhere: team.repliedElsewhere,
          teamSent: team.teamSent,
          fromSeenByClient: rf?.from ?? null,
          fromReason: rf?.fromReason ?? null,
          revise: d.status === "sent" || d.status === "done" || d.status === "skipped" ? { note: `Draft ${d.id} is ${d.status}: it is not revised. A new message on the owner's words: draft_write as a new reply to the newest message of the thread with owner_request, then record-draft with ownerRequest.` } : d.mailRef || isNewThreadDraft(d) ? { draft_write: { draft: d.id, content: d.mailRef ? "<the new reply>" : "<the new message>" }, then: "nothing: the revision records itself" } : { note: "No mailRef: this draft answers no Mail message, so draft_write cannot revise it." },
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      }),
  );

  server.registerTool(
    "client_show",
    {
      title: "One client of this project",
      description: `A client by id or by email: marks, reply state, last contact, and their drafts (id, status, subject). Only clients the agent recorded exist here (the Hub is not a client directory; Notion is the CRM). ${DATA}`,
      inputSchema: z.object({ id: z.number().int().positive().optional(), email: z.string().max(320).optional() }),
      annotations: READ_ONLY,
    },
    ({ id, email }) =>
      run(async () => {
        const slug = project();
        const cid = id ?? (email ? await repos.clients.idByEmail(slug, email.trim()) : undefined);
        if (cid === undefined) throw new ToolError("invalid", "Give the client's id or email.");
        const c = await repos.clients.card(slug, cid);
        if (!c) throw new ToolError("not_found", `No client ${id ?? email} in project ${slug}.`);
        const drafts = await repos.drafts.ofClient(slug, c.id);
        const notion = drafts.find((d) => d.notionUrl)?.notionUrl ?? null;
        return { ...c, name: cut(c.name), project: slug, notion, drafts: drafts.slice(0, 30).map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), createdAt: d.createdAt })) };
      }),
  );

  // P98: a client's message in Mail ▸ Inbox (`inbound:<id>` in the focus): who, what and when, where mail-mcp opens it, and the
  // draft_write call that answers it, so the agent never searches Mail to guess which message the owner means.
  server.registerTool(
    "inbound_show",
    {
      title: "One client message of this project's Inbox",
      description: `A message the Hub's Mail reader stored for this project (focus ref \`inbound:<id>\`, Mail ▸ Inbox): from (name and address), subject, when it arrived, the Mail Message-ID, \`inbound\` (account, mailbox_path, message_id: mail-mcp get_message_content reads the full text, and draft_write takes the same three for a new reply), the preview, whether it still waits (\`open\`), the draft that answers it, if any, and the client's drafts. "Prepare reply" / "ответь" on it is a work order: write the reply with \`draft_write\` at once (\`reply\` gives the call), then record it; never ask first. ${DATA}`,
      inputSchema: z.object({ inbound: z.number().int().positive().describe("The message's id, as the focus ref inbound:<id> gives it.") }),
      annotations: READ_ONLY,
    },
    ({ inbound }) =>
      run(async () => {
        const slug = project();
        const row = await repos.inboundMail.get(slug, inbound);
        if (!row) throw new ToolError("not_found", `No message ${inbound} in project ${slug}'s Inbox.`);
        const clientId = await repos.clients.idByEmail(slug, row.email);
        const drafts = clientId === undefined ? [] : await repos.drafts.ofClient(slug, clientId);
        const answer = answeringDraft(row, drafts);
        const pm = env.projectMail?.(slug);
        const found = env.drafts && pm ? await env.drafts.findInbound(pm.accounts, row.messageId).catch(() => null) : null;
        return {
          id: row.id,
          project: slug,
          from: { name: cut(row.name), email: row.email },
          subject: cut(row.subject, 300),
          receivedAt: row.receivedAt,
          messageIdHeader: row.messageId,
          account: row.account,
          mailbox: row.mailbox,
          preview: row.preview,
          why: row.why,
          open: row.open,
          dismissedAt: row.dismissedAt,
          inbound: found ? { account: found.account, mailbox_path: found.mailboxPath, message_id: found.messageId } : null,
          answer: answer ? { id: answer.id, status: answer.status, subject: cut(answer.subject), createdAt: answer.createdAt } : null,
          client: clientId === undefined ? null : { id: clientId },
          drafts: drafts.slice(0, 10).map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), createdAt: d.createdAt })),
          reply: answer
            ? { note: `Draft ${answer.id} already answers it: revise that one with draft_write { draft: ${answer.id} } when asked.` }
            : found
              ? { draft_write: { account: found.account, mailbox_path: found.mailboxPath, message_id: found.messageId, content: "<the reply>" }, then: "record it: ./run.sh record-draft with mailRef = messageIdHeader" }
              : { note: "Mail did not find the message now: find it with mail-mcp find_messages by its Message-ID (messageIdHeader), then draft_write." },
        };
      }),
  );

  server.registerTool(
    "drafts_list",
    {
      title: "The Mail list of this project (its drafts)",
      description: `The rows the admin's Mail list shows: the newest draft of each client, in the admin's order. view: one of ${CLIENT_FILTERS.join(", ")} (default ready). ${DATA}`,
      inputSchema: z.object({ view: z.enum(CLIENT_FILTERS).optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).optional() }),
      annotations: READ_ONLY,
    },
    ({ view, q, limit }) =>
      run(async () => {
        const slug = project();
        const filter = view ?? "ready";
        const opts = q ? { search: q } : {};
        const [rows, total] = await Promise.all([repos.clients.review(slug, filter, { ...opts, limit: limit ?? 20 }), repos.clients.reviewTotal(slug, filter, opts)]);
        return { project: slug, view: filter, total, drafts: rows.map((d) => ({ id: d.id, status: d.status, subject: cut(d.subject), client: { id: d.client.id, name: cut(d.client.name), email: d.client.email, repliesOwed: d.client.repliesOwed }, evidence: d.evidence ?? null, repliedElsewhere: d.repliedElsewhere, teamSent: d.teamSent })) };
      }),
  );

  server.registerTool(
    "project_notion",
    {
      title: "This project's Notion databases",
      description: `The bound project's own Notion databases by id (## Notion databases of project.md): role, data source id and its collection:// url, and the teamspace once its id is recorded. One Notion connector sees every teamspace the owner sees, and other projects have databases of the same names: query these ids, never a database found by notion-search. The guard refuses a query or a write on another one. ${DATA}`,
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () =>
      run(async () => {
        const slug = project();
        if (!env.projectNotion) throw new ToolError("unavailable", "This hub MCP server cannot read the project's Notion databases.");
        return projectNotion(env.projectNotion(slug));
      }),
  );

  server.registerTool(
    "mail_brand",
    {
      title: "Which brand a client wrote to",
      description: `The project's address the client wrote to (clientWroteTo: an address of ours, never the From of the reply) and its ## Brands row (brand), from the inbound's headers: pass \`headers\` = the allHeaders text of mail-mcp get_message_content (and its to and cc fields when it gives them separately). No Mail read. The order is fixed (X-Gm-Original-To, X-Original-To, X-Forwarded-For, X-Forwarded-To, Delivered-To, To, Cc; the project's account addresses only when nothing else matches), so never re-derive it from Delivered-To yourself. Use brand for the Notion Brand column and for knowledge_search; null brand means unbranded: say so, never guess. The draft's signature is added by draft_write, not by you. ${DATA}`,
      inputSchema: z.object({
        headers: z.string().max(40_000).optional().describe("The raw header block (allHeaders) of the client's message."),
        to: z.array(z.string().max(320)).max(50).optional().describe("The message's To addresses, when given apart from the headers."),
        cc: z.array(z.string().max(320)).max(50).optional().describe("The message's Cc addresses, when given apart from the headers."),
      }),
      annotations: READ_ONLY,
    },
    ({ headers, to, cc }) =>
      run(async () => {
        const slug = project();
        const id = env.projectMail?.(slug).identity;
        if (!env.projectMail || !id) throw new ToolError("unavailable", "This hub MCP server has no project identity to resolve a brand with.");
        const list: HeaderAddresses[] = [...headersFromText(headers ?? "")];
        if (to?.length && !list.some((h) => h.name === "to")) list.push({ name: "to", addresses: to });
        if (cc?.length && !list.some((h) => h.name === "cc")) list.push({ name: "cc", addresses: cc });
        const cfg = configOf(env.projectMail(slug));
        const r = resolveBrand(list, cfg);
        const sig = signatureFor(cfg, r);
        const { wroteTo, ...rest } = r;
        return { project: slug, clientWroteTo: wroteTo, ...rest, brands: cfg.brands.map((b) => b.name), signature: sig.placeholder ? "placeholder" : sig.lines.length ? "signed" : "none" };
      }),
  );

  server.registerTool(
    "draft_write",
    {
      title: "Write or revise an unsent reply draft in Mail",
      description: `Saves an unsent reply to one message in Mail's Drafts, with Mail in the background (no window, no focus, no paste). Use it for every draft and every revision instead of mail-mcp create_reply. A revision of a hub draft: \`draft\` = its id and \`content\`, nothing else (the hub finds the message it answers from its mailRef), plus \`reason\` when the draft's "Why this email" line should change; a sent draft is refused with already_sent and a done or skipped one with draft_finished, before Mail is asked (a new message then is a new reply with owner_request). A new reply: \`account\`, \`mailbox_path\` and \`message_id\` of the message answered (message_id is mail-mcp's integer id, never a hub draft id). Give the reply body only, plain text: the hub adds nothing to the text but its sign-off and the brand's signature, so never end with your own closing, in any language ("Best regards", "С уважением", "С теплом и …,", "Viele Grüße"), nor a team, brand or personal name line ("Carapis team", "Команда Carapis"): that is refused with own_signoff, rewrite without it. A new reply to a message this project already has a draft for is refused with already_drafted: that is the skip of a rerun, not an error (revise that draft with \`draft\` = its id when the owner asks). To write to a client again on the owner's initiative (P85: the client has not answered, or our draft was sent): reply to the NEWEST message of the client's latest thread, ours (in Sent) or theirs, and pass \`owner_request\` = the owner's own words from this session, verbatim, never yours; then a message whose drafts are all finished gets a new one, and a reply to our own message goes to that message's recipients. mail_slow means Mail is slow: the write may still land and the hub adopts it as the draft's version; do not call draft_write again for that draft, tell the owner in one line, and never ask him to delete a Mail draft. A revision saves the new draft first, then moves the older version the hub recorded to Trash, so one version stays; the open admin card shows the new text within seconds. The result's fromSeenByClient is exactly the From the client sees (there is no hidden sender): the address they wrote to (clientWroteTo) when this project's Mail account can send as it, else the account that received the mail (the design for a brand address that forwards into it, not a fault); fromReason is set only when it fell back to mail.sender. A client with NO thread at all (P85b: we never wrote and they never wrote; search Mail by their address first): on the owner's words only, a NEW message with \`to\` = the client's address from the project's Notion Clients, \`subject\`, \`content\` and \`owner_request\` (no account, mailbox_path or message_id; \`account\` and \`from\` optional: one of the project's accounts and its own address, default mail.sender); refused with has_thread when the hub already wrote to them (reply to the newest message instead), do_not_contact when the client is marked so, and not_a_client when the address is neither a recorded client nor a row of the project's Notion Clients or Leads (checked by the hub, P87; a lead, P97: answer a Notion Leads row this way, to its reply address, with \`brand\` = its Lead.Brand so the message is signed as that brand; in test mode, draft.recipients test, the owner's test addresses of the allow_list pass without it, P92); record it with \`"newThread":true\` in place of mailRef. A first draft of a thread: then record it with \`hub record-draft --project <slug>\` and mailRef = the returned thread; a revision records itself. Only this project's Mail accounts. Never sends. ${DATA}`,
      inputSchema: z.object({
        draft: z.number().int().positive().optional().describe("Revise this hub draft (its id, as focus or draft_show gives it). Then leave account, mailbox_path and message_id out."),
        account: z.string().min(1).max(320).optional().describe("New reply: Mail account of the message answered, as mail-mcp names it."),
        mailbox_path: z.array(z.string().min(1).max(200)).min(1).max(8).optional().describe('New reply: mailbox path of that message, e.g. ["INBOX"].'),
        message_id: z.number().int().positive().optional().describe("New reply: mail-mcp's integer id of the message answered."),
        content: z.string().min(1).max(20_000).describe("The reply body, plain text, with no sign-off or signature of your own: the hub signs."),
        to: z.string().trim().email().max(320).optional().describe("New thread (P85b): the client's address, from the project's Notion Clients. Only for a client with no thread at all; needs owner_request and subject."),
        subject: z.string().trim().min(1).max(300).optional().describe("New thread: the subject of the new message."),
        from: z.string().trim().email().max(320).optional().describe("New thread: the project's own address to write from (a brand address); default mail.sender, else the account's own."),
        brand: z.string().trim().min(1).max(100).optional().describe("New thread (P97): the ## Brands row the message is signed as (a lead's Lead.Brand), whatever address it goes from; a name not in ## Brands is refused."),
        reason: z.string().trim().min(1).max(500).optional().describe("Revision (P99): a new \"Why this email\" line for the draft's record, one short English sentence on why the client gets this reply; omitted, the recorded reason stays. In test mode never mention a test or the owner's own address in it."),
        owner_request: z.string().trim().min(1).max(1000).optional().describe("New reply on the owner's initiative (P85): his own words from this session that asked for it, verbatim (never yours). Lets a message whose drafts are all finished get a new one; pass the same words to record-draft as ownerRequest."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ draft, account, mailbox_path, message_id, content, owner_request, to, subject, from: fromAddress, brand: brandName, reason }) =>
      run(advised(async () => {
        const slug = project();
        if (!env.drafts || !env.projectMail) throw new ToolError("unavailable", "This hub MCP server cannot write drafts (no Mail writer).");
        const writer = env.drafts;
        const mail = env.projectMail(slug);
        const cfg = configOf(mail);
        // P65 S2 (P60 finding 1): the writer signs, so the agent's own closing would be a second one. Refused, never edited.
        // Only where the writer signs at all (an identity with a sign-off or a Brands table).
        if (mail.identity && (cfg.signoff.trim() || cfg.brands.length)) {
          const own = ownSignoff(content, signatureLines(cfg), signingNames(cfg));
          if (own) throw new ToolError("own_signoff", `Your text ends with your own closing "${cut(own, 80)}": the hub signs every draft itself (the project's sign-off and the brand's signature). Remove that line (and any team or company name under it) and call draft_write again. Nothing was written.`);
        }
        // P60: the writer signs. The brand comes from the answered message's headers; an unreadable header block in a
        // project with brands gives the placeholder, never another brand's lines. P65 S2: in the reply's language.
        // P87 (B6): a reply to our own sent message keeps the brand that message carried (the thread's), not the account's.
        const sign = mail.identity
          ? async (inbound: InboundMessage, body: string, thread?: { brand: string; wroteTo: string | null; draftId: number }): Promise<Signed> => {
              const raw = await writer.readHeaders(inbound).catch(() => null);
              const r = thread ? { wroteTo: thread.wroteTo, brand: thread.brand, via: "address" as const, reason: `the thread's earlier draft ${thread.draftId} was ${thread.brand}'s` } : raw === null ? null : resolveBrand(headersFromText(raw), cfg);
              const block = signatureFor(cfg, r, replyLanguage(body));
              return { body: signBody(body, block, signatureLines(cfg)), wroteTo: r?.wroteTo ?? null, brand: r?.brand ?? null, brandReason: r?.reason ?? "the message's headers could not be read", signature: block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
            }
          : undefined;
        // P85b: a new thread has no answered message: its brand is the one of the address it goes from. P97 S3: or the brand named
        // (a lead's Lead.Brand): on saas every brand's mail goes from hello@reforms.ai, so the From cannot tell Carapis from Reforms.
        const signFrom = (fromAddr: string, body: string, named?: string | null): Signed => {
          const row = named ? cfg.brands.find((b) => b.name.toLowerCase() === named.toLowerCase()) : undefined;
          const res = row ? { wroteTo: null, brand: row.name, via: "address" as const, reason: `the brand ${row.name} was named for this message` } : resolveBrand(headersFromText(`From: ${fromAddr}`), cfg);
          const block = signatureFor(cfg, res, replyLanguage(body));
          return { body: mail.identity ? signBody(body, block, signatureLines(cfg)) : body, wroteTo: null, brand: res.brand, brandReason: res.reason, signature: !mail.identity ? "none" : block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
        };
        if (reason !== undefined && draft === undefined) throw new ToolError("invalid", "reason is for a revision (draft = its id); a first draft's reason goes to record-draft. Nothing was written.");
        const isOurs = (a: string) => isOwnAddress(a, cfg.mail) || (!!mail.sender && normalizeAddress(a) === normalizeAddress(mail.sender));
        try {
          let r: Revision;
          let versionRows: Array<{ id: number; messageId: string }> = [];
          let mailRef: string;
          if (draft !== undefined) {
            if (account !== undefined || mailbox_path !== undefined || message_id !== undefined) throw new ToolError("invalid", "Give either draft (a revision) or account, mailbox_path and message_id (a new reply), not both.");
            const { d } = await ownDraft(draft);
            // P83 verdict 2: a sent mail is not revised, and no second draft is made for the message it answered.
            if (d.status === "sent") throw new ToolError("already_sent", alreadySentText(d.id, d.sentAt ?? null));
            // P99 S0 (a): a finished draft is refused before Mail is asked (draft 4 on 2026-11-21: the write landed, then the record refused).
            if (d.status === "done" || d.status === "skipped") throw new ToolError("draft_finished", draftFinishedText(d.id, d.status));
            if (!d.mailRef && isNewThreadDraft(d)) {
              // P85b: a new thread is revised as a new message to the same client, the recorded versions replaced.
              const client = d.toAddr.match(/[^\s,;<>"']+@[^\s,;<>"']+/)?.[0] ?? d.toAddr;
              mailRef = newThreadKey(client);
              const live = (await repos.mailVersions.ofDraft(d.id)).filter((v) => !v.trashedAt);
              versionRows = live.map((v) => ({ id: v.id, messageId: v.messageId }));
              const acc = live[0]?.account ?? mail.accounts[0];
              if (!acc) throw new ToolError("not_this_project", `Project ${slug} lists no Mail account.`);
              // P97 S3: a new thread signed as a named brand keeps that brand on revision.
              const signed = signFrom(mail.sender ?? acc, content, d.brand ?? null);
              const { body: _b, ...how } = signed;
              r = { ...(await reviseDraft(writer, { accounts: mail.accounts, sender: mail.sender, mailRef: null, body: signed.body, quote: "keep", versions: live.map((v) => ({ account: v.account, messageId: v.messageId })), newThread: { to: client, subject: d.subject, account: acc, from: mail.sender }, ...(env.withRepos ? { log: writeLogOf(env.withRepos, slug, d.id, mailRef) } : {}) })), ...how };
            } else {
              if (!d.mailRef) throw new ToolError("no_thread", `Draft ${draft} has no mailRef: it answers no Mail message, so it cannot be revised here.`);
              mailRef = d.mailRef;
              const all = await repos.mailVersions.ofDraft(d.id);
              // P65 S5: a late save of the Hub's own earlier write is adopted first, so this write replaces it too.
              const adopted = await adoptLate(slug, d.id, d.mailRef, d.subject, all);
              const live = [...all.filter((v) => !v.trashedAt), ...adopted];
              versionRows = live.map((v) => ({ id: v.id, messageId: v.messageId }));
              // The one revision path, shared with the admin's Save and Restore (P56).
              r = await reviseDraft(writer, { accounts: mail.accounts, sender: mail.sender, clientWroteTo: d.wroteTo ?? null, mailRef: d.mailRef, body: content, quote: "add", versions: live.map((v) => ({ account: v.account, messageId: v.messageId })), ...(sign ? { sign } : {}), ...(env.withRepos ? { log: writeLogOf(env.withRepos, slug, d.id, d.mailRef) } : {}) });
            }
          } else if (to !== undefined) {
            // P85b: a brand-new thread to a client the project never wrote to and who never wrote, on the owner's words only.
            if (mailbox_path !== undefined || message_id !== undefined) throw new ToolError("invalid", "A new thread takes to, subject, content and owner_request (account and from optional), not mailbox_path or message_id.");
            if (!owner_request) throw new ToolError("owner_request_needed", "A new thread is written only on the owner's words: pass owner_request = his own words from this session, verbatim. Nothing was written.");
            if (!subject) throw new ToolError("invalid", "A new thread needs a subject.");
            if (brandName !== undefined && !cfg.brands.some((b) => b.name.toLowerCase() === brandName.toLowerCase())) throw new ToolError("invalid", `"${brandName}" is not a row of project ${slug}'s ## Brands (${cfg.brands.map((b) => b.name).join(", ") || "none"}). Nothing was written.`);
            const email = normalizeAddress(to);
            if (isOurs(email)) throw new ToolError("not_this_project", `${email} is one of this project's own addresses: a new message goes to the client, never to us. Nothing was written.`);
            const clientId = await repos.clients.idByEmail(slug, email);
            if (clientId !== undefined) {
              const card = await repos.clients.card(slug, clientId);
              if (card?.marks.includes("do_not_contact")) throw new ToolError("do_not_contact", `${email} is marked do not contact in this project: no message is written. Nothing was written.`);
              const rows = await repos.drafts.ofClient(slug, clientId);
              const open = rows.find((x) => x.status === "ready" || x.status === "hold");
              if (open) throw new ToolError("already_drafted", `Draft ${open.id} of this client waits for review: revise it with draft=${open.id}. Nothing was written.`);
              if (rows[0]) throw new ToolError("has_thread", `The hub already wrote to ${email} (draft ${rows[0].id}, ${rows[0].status}): a thread exists. Reply to its newest message (ours in Sent, or theirs) with owner_request instead of a new thread. Nothing was written.`);
            } else if (!(env.testRecipients?.(slug) ?? []).some((a) => normalizeAddress(a) === email)) {
              // P87: a new thread goes only to a client: a recorded one passes above, any other address must be in the project's Notion Clients.
              const check: NotionClientCheck = env.clientInNotion ? await env.clientInNotion(slug, email).catch((e: unknown) => ({ state: "unavailable" as const, reason: `the Notion read failed (${e instanceof Error ? e.name : "error"})` })) : { state: "unavailable", reason: "this hub MCP server has no Notion reader" };
              if (check.state === "unavailable") throw new ToolError("notion_unavailable", `${email} is not a recorded client, and the project's Notion Clients could not be checked: ${check.reason}. Nothing was written.`);
              if (check.state === "do_not_contact") throw new ToolError("do_not_contact", `${email} is marked Do not contact in the project's Notion Clients: no message is written. Nothing was written.`);
              if (check.state === "not_client") throw new ToolError("not_a_client", `${email} is not a client of project ${slug}: no row of its Notion Clients or Leads (Status not Spam) has this address, and the Hub has no record of it. A new thread goes only to a client or a lead. Nothing was written.`);
              // P97 S3 (decision 0044 point 2): a Leads row of the project is a known person for a new thread.
            }
            mailRef = newThreadKey(email);
            const pending = (await repos.mailVersions.ofThread(slug, mailRef)).find((v) => v.draftId === null && !v.trashedAt);
            if (pending) throw new ToolError("already_drafted", `The hub already wrote a new message to ${email} (Mail id ${pending.mailId}) that is not recorded yet: record it with hub record-draft ("newThread":true), then revise it with draft=<id>. Nothing was written.`);
            const landing = (await repos.mailWrites.ofThread(slug, mailRef).catch(() => [])).find((w) => !w.settledAt && w.draftId === null && Date.parse(w.startedAt) > (env.now?.() ?? new Date()).getTime() - LANDING_MS);
            if (landing) throw new ToolError("mail_slow", `The hub's new message to ${email} at ${landing.startedAt} has not shown in Mail yet (Mail is slow). Do not write it again now: tell the owner in one line. Nothing was written.`);
            const acc = account === undefined ? mail.accounts[0] : mail.accounts.find((a) => a.trim().toLowerCase() === account.trim().toLowerCase());
            if (!acc) throw new ToolError("not_this_project", `Account "${account ?? ""}" is not one of project ${slug}'s Mail accounts (${mail.accounts.join(", ") || "none listed in project.md"}).`);
            if (fromAddress !== undefined && !isOurs(fromAddress)) throw new ToolError("not_this_project", `${fromAddress} is not one of project ${slug}'s own addresses: a new message goes from the project's sender or a brand address.`);
            const sender = fromAddress ?? mail.sender ?? null;
            const signed = signFrom(sender ?? acc, content, brandName ?? null);
            const w = await writeRecorded(writer, { kind: "new", account: acc, sender, to: email, subject, body: signed.body, replace: [], landIn: mail.accounts }, env.withRepos ? writeLogOf(env.withRepos, slug, null, mailRef) : undefined);
            const { body: _body, ...how } = signed;
            r = { ...w, replyTo: 0, account: w.savedIn || acc, fromReason: null, clientWroteTo: null, ...how };
          } else {
            if (account === undefined || mailbox_path === undefined || message_id === undefined) throw new ToolError("invalid", "Give draft (a revision of a hub draft) or all of account, mailbox_path and message_id (a new reply).");
            const own = mail.accounts.find((a) => a.trim().toLowerCase() === account.trim().toLowerCase());
            if (!own) throw new ToolError("not_this_project", `Account "${account}" is not one of project ${slug}'s Mail accounts (${mail.accounts.join(", ") || "none listed in project.md"}).`);
            const inbound = { account: own, mailboxPath: mailbox_path, messageId: message_id };
            // P65 verdict 4: a rerun is idempotent through the record, not through Drafts. Asked before anything is written.
            // P87: a hub draft id passed as message_id (the walkthrough's first try) is named, with the field to use instead.
            mailRef = await writer.messageIdOf(inbound).catch(async (e: unknown) => {
              if (!(e instanceof DraftWriteError) || e.code !== "no_message") throw e;
              const hub = await repos.drafts.get(message_id);
              const asDraft = hub && hub.project === slug ? ` ${message_id} is hub draft ${message_id} (${hub.status}) of this project: to revise it pass draft=${message_id} and content only;${hub.status === "sent" ? " it is sent, so for a new message reply to the newest message of its thread (ours in Sent) with owner_request;" : ""}` : "";
              throw new ToolError("wrong_message_id", `No message ${message_id} in ${mailbox_path.join("/")} of ${own}.${asDraft} message_id is mail-mcp's integer id of the message answered (the id find_messages or list_messages gives), never a hub draft id. Nothing was written.`);
            });
            const rows = await repos.drafts.byMailRef(slug, mailRef);
            const open = rows.find((x) => x.status === "ready" || x.status === "hold");
            if (open) throw new ToolError("already_drafted", `Draft ${open.id} already answers this message: revise it with draft=${open.id}. Nothing was written.`);
            // P85: the owner's own words ask for a new message; without them a finished draft is the skip of a rerun.
            if (rows[0] && !owner_request) throw new ToolError("already_drafted", `Draft ${rows[0].id} (${rows[0].status}) already answered this message: a rerun does not bring it back. Only when the owner asked in this session for a new message to this client: reply to the newest message of the thread (ours in Sent, or theirs) with owner_request = his words. Nothing was written.`);
            const thread = await repos.mailVersions.ofThread(slug, mailRef);
            await adoptLate(slug, null, mailRef, null, thread.filter((v) => v.draftId === null));
            const pending = (await repos.mailVersions.ofThread(slug, mailRef)).find((v) => v.draftId === null && !v.trashedAt);
            if (pending) throw new ToolError("already_drafted", `The hub already wrote a draft for this message (Mail id ${pending.mailId}) that is not recorded yet: record it with hub record-draft (mailRef ${mailRef}), then revise it with draft=<id>. Nothing was written.`);
            // P65 S5: the Hub's last write for this message may still be landing (Mail slow): a second one would be a duplicate.
            const landing = (await repos.mailWrites.ofThread(slug, mailRef).catch(() => [])).find((w) => !w.settledAt && w.draftId === null && Date.parse(w.startedAt) > (env.now?.() ?? new Date()).getTime() - LANDING_MS);
            if (landing) throw new ToolError("mail_slow", `The hub's write for this message at ${landing.startedAt} has not shown in Mail yet (Mail is slow); it is adopted when it lands. Do not write it again now: tell the owner in one line, and record it with hub record-draft once draft_write for it reports it saved. Nothing was written.`);
            // P87 (B6): the message answered is our own sent mail when a hub draft of this project went out as it.
            const ours = owner_request ? await repos.drafts.bySentMessageId(slug, mailRef) : null;
            const ourThread = ours?.brand ? { brand: ours.brand, wroteTo: ours.wroteTo ?? null, draftId: ours.id } : undefined;
            const signed = sign ? await sign(inbound, content, ourThread) : null;
            // P58: From the address the client wrote to when the receiving account can send as it, else that account.
            const rf = await fromFor(writer, inbound, signed?.wroteTo ?? null, mail);
            const w = await writeRecorded(writer, { ...inbound, body: signed?.body ?? content, sender: rf.from, replace: [], landIn: mail.accounts }, env.withRepos ? writeLogOf(env.withRepos, slug, null, mailRef) : undefined);
            const savedIn = w.savedIn || own;
            const why = { fromReason: rf.fromReason, clientWroteTo: rf.clientWroteTo };
            if (signed) {
              const { body: _body, ...how } = signed;
              r = { ...w, replyTo: message_id, account: savedIn, ...how, ...why };
            } else r = { ...w, replyTo: message_id, account: savedIn, ...why };
          }
          let live = true;
          try {
            env.mailWritten?.(slug);
          } catch {
            live = false; // the draft is saved; only the open card's refresh is lost (it reads Mail again on focus)
          }
          // P65: the version is the Hub's record of what it wrote; the replaced ones are marked trashed.
          let versionError: string | null = null;
          if (env.recordVersion) {
            const moved = new Set(r.replaced.map((x) => x.toLowerCase()));
            try {
              await env.recordVersion(slug, { draftId: draft ?? null, mailRef, account: r.account, mailId: r.draftId, messageId: r.messageId, hash: versionHash(r.text), signatureFallback: r.signatureFallback ?? null, trashed: versionRows.filter((v) => moved.has(v.messageId.toLowerCase())).map((v) => v.id) });
            } catch (e) {
              versionError = e instanceof Error ? e.message : String(e);
            }
          }
          const left = r.left.length ? ` Older hub version(s) ${r.left.join(", ")} are still in Drafts: Send names them until one is left; hub drafts sweep (dry run) lists them for the owner. Never ask the owner to delete a Mail draft.` : "";
          const signNote = r.signature === "placeholder" ? ` The draft ends with [Owner: signature for ...] (${r.brandReason}): hub send refuses it until the owner fills it in; say so in your one line.` : "";
          const langNote = r.signatureFallback ? ` The project has no sign-off or signature line for "${r.signatureFallback}", the reply's language: it was signed in English and the card shows the check signature_language; say so in your one line.` : "";
          const versionNote = versionError ? ` The hub could not record this Mail version (${versionError}): Skip and Done will not move it to Trash; say so in your one line.` : "";
          // A revision of a known hub draft is recorded here, in place; only a first draft of a thread needs `record-draft`.
          let recorded: { draftId: number; action: string } | null = null;
          let recordError: string | null = null;
          if (draft !== undefined && env.recordRevision) {
            try {
              recorded = await env.recordRevision(slug, draft, { excerpt: excerptOf(content), wroteTo: r.clientWroteTo ?? r.wroteTo ?? null, brand: r.brand ?? null, ...(reason !== undefined ? { reason } : {}) });
            } catch (e) {
              recordError = e instanceof Error ? e.message : String(e);
            }
          }
          // P58: the From is exactly what the client sees; a From that is not the address they wrote to is said, with its reason.
          const fromNote = r.fromReason ? ` The client sees From ${r.from}, not ${r.clientWroteTo ?? "the address they wrote to"} (${r.fromReason}); say so in your one line.` : "";
          // P90: a revision of a draft whose thread someone else already answered succeeds, and says so.
          const team = draft !== undefined ? await repos.drafts.teamNotice(draft).catch(() => null) : null;
          const warning = team?.repliedElsewhere ? `${team.repliedElsewhere.by} already replied in this thread at ${team.repliedElsewhere.at} (not this Hub's mail): this draft may repeat or contradict it; say so in your one line.` : team?.teamSent ? `${team.teamSent.by} wrote to this client at ${team.teamSent.at} (Notion Last sent by): say so in your one line.` : null;
          const notes = `${fromNote}${signNote}${langNote}${versionNote}${left}${warning ? ` ${warning}` : ""}`;
          const next = recorded
            ? `Recorded: draft ${recorded.draftId} updated in place (same id, mailRef, client and context; Checked is off because the text changed). Do not run record-draft. Tell the owner in one line what you changed. Nothing was sent.${notes}`
            : draft !== undefined
              ? `Saved in Mail but NOT recorded: the hub could not update draft ${draft} in place${recordError ? ` (${recordError})` : ""}. Record it once, one Bash call from the instance folder: \`echo '{"email":"<client>","subject":"${r.subject.replace(/["'\\]/g, "")}","mailRef":"${r.thread}","skill":"triage-mail","excerpt":"<first 240 chars of your reply>"}' | ./run.sh record-draft --project ${slug}\`; if it answers "recorded":false, nothing was recorded: tell the owner in one line that the new text is in Mail and the card still shows the old one, never "recorded". Nothing was sent.${notes}`
              : to !== undefined
              ? `Record it, one Bash call from the instance folder: \`echo '{"email":"${normalizeAddress(to)}","subject":"${r.subject.replace(/["'\\]/g, "")}","newThread":true,"skill":"bulk-drafts","ownerRequest":"${(owner_request ?? "").replace(/["'\\]/g, "")}","excerpt":"<first 240 chars of your message>","context":{"batchKey":"<one key for every client of this run>","batchTitle":"<short English title>",...}}' | ./run.sh record-draft --project ${slug}\` (JSON on stdin; a new thread has no mailRef; the records of one run share batchKey and are one batch in Drafts). Then tell the owner in one line who it goes to. Nothing was sent.${notes}`
              : `Record it, one Bash call from the instance folder: \`echo '{"email":"<client>","subject":"${r.subject.replace(/["'\\]/g, "")}","mailRef":"${r.thread}","skill":"${owner_request ? "bulk-drafts" : "triage-mail"}",${owner_request ? `"ownerRequest":"${owner_request.replace(/["'\\]/g, "")}",` : ""}"excerpt":"<first 240 chars of your reply>","context":{${owner_request ? `"batchKey":"<one key for every client of this run>","batchTitle":"<short English title>",` : ""}...}}' | ./run.sh record-draft --project ${slug}\` (JSON on stdin; skill ${owner_request ? "bulk-drafts" : "triage-mail step 5"}). Then tell the owner in one line what you changed. Nothing was sent.${notes}`;
          // P58 live finding: unambiguous names for the agent. `fromSeenByClient` is Mail's own read of the saved draft's From.
          const { text: _text, shell: _shell, from, wroteTo: _wroteTo, ...shown } = r;
          return { ...shown, fromSeenByClient: from, clientWroteTo: r.clientWroteTo, fromReason: r.fromReason, project: slug, sent: false, ...(draft !== undefined ? { draft } : {}), ...(owner_request ? { ownerRequest: owner_request } : {}), ...(to !== undefined ? { newThread: true } : {}), recorded: recorded !== null, live, ...(warning ? { warning } : {}), next };
        } catch (e) {
          if (e instanceof DraftWriteError) throw new ToolError(e.code, e.message);
          throw e;
        }
      })),
  );

  registerMessengerTools(server, repos, { project, ...(env.withRepos ? { withRepos: env.withRepos } : {}), ...(env.now ? { now: env.now } : {}) });

  return server;
}

/** P83: every refusal of `draft_write` says whether another call can help (`retry`) and what to tell the owner (`next`). */
const advised = (fn: () => Promise<Record<string, unknown>>) => async (): Promise<Record<string, unknown>> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError) throw new ToolError(e.code, e.message, { ...adviceOf(e.code), ...e.detail });
    throw e;
  }
};

/** The slice of the project's config that `resolveBrand` and `signatureFor` read. */
function configOf(m: ProjectMail): { mail: { accounts: string[]; addresses: string[]; domains: string[] }; signoff: string; brands: Brand[]; languages: string[] } {
  const id = m.identity ?? { addresses: [], domains: [], signoff: "", brands: [], languages: ["en"] };
  return { mail: { accounts: m.accounts, addresses: id.addresses, domains: id.domains }, signoff: id.signoff, brands: id.brands, languages: id.languages };
}
