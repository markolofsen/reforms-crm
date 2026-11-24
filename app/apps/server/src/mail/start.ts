import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import type { ProjectStore } from "@hub/projects/store";
import type { SentNotice } from "@hub/send/assess";
import { ops } from "@hub/log/ops";
import { readHistory } from "@hub/mail-app/history";
import { mailAppDraftWriter } from "@hub/mail-app/writer";
import { FakeDraftWriter } from "@hub/mail-app/writer/fake";
import { osaFor } from "@hub/mail-app/osa";
import { mailRunning, readMessageText } from "@hub/mail-app/read";
import { stampSentMail, teamStampOf } from "@hub/notion/stamp";
import type { Runtime } from "../composition/runtime";
import { createServerMailer } from "../send/mailer";
import { convertSentLead, startLeadsReader } from "../clients/leads-reader";
import type { ConversationMail } from "./context";
import { bodyCache } from "./conversation";
import { startInboundReader } from "./inbound";
import { startSentReconciler } from "./sent";

export type MailStart = {
  repos: Repos;
  paths: HubPaths;
  modes: RuntimeModes;
  projectsDir: string;
  projects: ProjectStore;
  /** Whether the admin is open or a session runs (the Mail reader reads every 2 min then, else every 15). Bound after live starts. */
  busy: () => boolean;
  /** Whether an address is a client in the autolink's directory of that project. */
  knownClient: (project: string, email: string) => boolean;
  /** P140 verdict 3: moves the `mail` live topic of a project (the open history re-reads). */
  mailMoved: (project: string) => void;
};

export type MailRuntime = {
  kind: "mail-app" | "fake";
  mailer: ReturnType<typeof createServerMailer>["mailer"];
  writer: FakeDraftWriter | ReturnType<typeof mailAppDraftWriter>;
  onSent?: (n: SentNotice) => void;
  handles: Omit<Runtime["mail"], "sender">;
  /** The Sent reconciler's and the Mail reader's state lines for the `health` live topic. */
  states: () => { state: string; reason?: string; lastError?: string | null | undefined }[];
  stop(): void;
};

const NOT_RUNNING = (what: string) => ({ note: `Mail is not running: open Mail to ${what}.` });
const GONE = { note: "This message is no longer in Mail (moved or deleted)." };

/**
 * The Mail domain at start (P126 S1): the Mailer, the Sent reconciler, the Leads reader, the Mail reader and the readers of one
 * message, one person's history and one body. With the fake Mailer (HUB_MAILER=fake) nothing asks Mail or Notion.
 */
export function start(o: MailStart): MailRuntime {
  const log = ops("server");
  const { repos, paths, projectsDir, projects } = o;
  const { kind, mailer } = createServerMailer(repos, projectsDir, o.modes.mailer);
  const fake = kind === "fake";
  log.info(fake ? "SEND IS FAKE (HUB_MAILER=fake): nothing leaves this process" : "send: Mail.app (a person confirms every send in the admin)");
  const notion = { projectsDir, secretsDir: paths.secrets, stateDir: paths.state };
  // P89, P97 S4 (decision 0044 point 3): after a confirmed send, first the lead's Clients card, then the Last sent stamp; in the
  // background, each never throws and never touches the send. Off with the fake Mailer (nothing was really sent).
  const onSent = fake ? undefined : (n: SentNotice) => {
    void (async () => {
      await convertSentLead({ repos, projectsDir }, n);
      await stampSentMail(notion, n);
    })();
  };
  // Decision 0026: Sent detection reads Apple Mail's Sent mailbox while a draft waits; P90: each pass also reads teammates' stamps.
  const teamStamp = fake ? undefined : (project: string, email: string) => teamStampOf(notion, project, email);
  const sent = startSentReconciler({ repos, projects, ...(onSent ? { onSent } : {}), ...(teamStamp ? { teamStamp } : {}), ...(fake ? { offReason: "HUB_MAILER=fake: Mail is not read" } : {}) });
  log.info(`sent: ${sent.status().state}${sent.status().reason ? ` (${sent.status().reason})` : ""}`);
  // P97 S2: the Leads reader reads each active project's Notion Leads at start, every 15 minutes, and on a new lead notice.
  const leads = startLeadsReader({ repos, projectsDir, ...(fake ? { offReason: "Demo mode: Notion Leads are not read" } : {}) });
  // P96: the Mail reader reads the projects' inbound mailboxes read-only.
  const inbound = startInboundReader({
    onNotice: (project) => void leads.read(project),
    onDoorSendRecorded: o.mailMoved,
    repos,
    projectsDir,
    policyDir: paths.stateProjects,
    configFile: paths.configFile,
    busy: o.busy,
    knownClient: o.knownClient,
    ...(fake ? { offReason: "Demo mode: Mail is not read" } : {}),
  });
  log.info(`mail reader: ${inbound.status().state}${inbound.status().reason ? ` (${inbound.status().reason})` : ""}`);
  const writer = fake ? new FakeDraftWriter() : mailAppDraftWriter();
  // The Inbox card's text, read from Mail when a row is opened (never launches Mail).
  const inboundText = async (account: string, messageId: string): Promise<{ text: string } | { note: string }> => {
    if (fake) return { note: "Demo mode: Mail is not read, only the stored preview shows." };
    if (!(await mailRunning(osaFor("long")).catch(() => false))) return NOT_RUNNING("read the whole message");
    const found = await writer.findInbound([account], messageId);
    return found ? { text: await writer.readContent(found) } : GONE;
  };
  return {
    kind,
    mailer,
    writer,
    ...(onSent ? { onSent } : {}),
    handles: { sent: sent.status, sentPass: sent.tick, inbound, leads, inboundText, conversation: fake ? demoConversation : conversationMail(writer, inboundText) },
    states: () => [sent.status(), { state: inbound.status().state, reason: `${inbound.status().reason ?? ""}${inbound.status().reading ? " reading" : ""}${inbound.status().lastRunAt ?? ""}`, lastError: inbound.status().lastError }],
    stop: () => {
      sent.stop();
      inbound.stop();
      leads.stop();
    },
  };
}

const demoConversation: ConversationMail = {
  history: async () => ({ note: "Demo mode: Mail is not read, the Hub's own rows show." }),
  text: async () => ({ note: "Demo mode: Mail is not read, only the stored preview shows." }),
  headers: async () => ({ note: "Demo mode: Mail headers are not read." }),
};

/**
 * P99: one person's history for the conversation pane, read from Mail on open, and one body on demand, kept in this process's
 * memory only (decision 0013).
 */
function conversationMail(writer: ReturnType<typeof mailAppDraftWriter>, inboundText: (account: string, messageId: string) => Promise<{ text: string } | { note: string }>): ConversationMail {
  const bodies = bodyCache();
  const keyOf = (at: { account: string; mailbox: string; mailId: number } | { account: string; messageId: string }) => ("messageId" in at ? `${at.account}|${at.messageId}` : `${at.account}|${at.mailbox}|${at.mailId}`);
  return {
    forget: (ats) => {
      for (const at of ats) bodies.delete(keyOf(at));
    },
    history: async (q) => {
      const osa = osaFor("read");
      if (!(await mailRunning(osa).catch(() => false))) return NOT_RUNNING("see the whole conversation");
      const t0 = Date.now();
      const messages = await readHistory(osa, q);
      return { messages, ms: Date.now() - t0 };
    },
    text: async (at) => {
      const key = keyOf(at);
      const hit = bodies.get(key);
      if (hit !== null) return { text: hit };
      const read: { text: string } | { note: string } =
        "messageId" in at
          ? await inboundText(at.account, at.messageId)
          : await (async () => {
              const osa = osaFor("read");
              if (!(await mailRunning(osa).catch(() => false))) return NOT_RUNNING("read the whole message");
              const text = await readMessageText(osa, at.account, at.mailbox, at.mailId);
              return text === null ? GONE : { text };
            })();
      if ("text" in read) bodies.set(key, read.text);
      return read;
    },
    headers: async ({ account, messageId }) => {
      const osa = osaFor("read");
      if (!(await mailRunning(osa).catch(() => false))) return NOT_RUNNING("resolve the conversation's recipient");
      const found = await writer.findInbound([account], messageId);
      if (!found) return GONE;
      return { headers: await writer.readHeaders(found), accountAddresses: found.accountAddresses ?? [account] };
    },
  };
}
