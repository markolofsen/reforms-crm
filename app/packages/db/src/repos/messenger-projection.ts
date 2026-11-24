import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { HIDDEN_LABELS, isHiddenLabel, type HiddenLabel, type TriageVerdict } from "@hub/config/chat-rules";
import type { Db } from "../client";
import { clientIdentifiers, clients, inboxRows, messengerChats, messengerDrafts, messengerMessages, messengerTriage, type MessengerChannel } from "../schema";
import { linkKindOf, type ChatActivity, type MessengerChatRow } from "./messenger-chats";
import type { MessengerDraftRow, MessengerMessageRow } from "./messengers";
import type { TriageCounts } from "./messenger-triage";

export interface MessengerProjectionRow {
  row: MessengerChatRow;
  /** The client the chat is linked to; null for a known chat that is not linked (decision 0049). */
  client: { id: number; name: string; email: string | null } | null;
  notion: { notionPageId: string | null; notionUrl: string | null } | null;
  activity: ChatActivity;
  stored: number;
  last: MessengerMessageRow | null;
  lastVerdict: TriageVerdict | null;
  draft: MessengerDraftRow | null;
  triage: TriageCounts;
}

const chatKey = (channel: MessengerChannel, chatId: string) => `${channel}:${chatId}`;
const zeroHidden = (): Record<HiddenLabel, number> => Object.fromEntries(HIDDEN_LABELS.map((label) => [label, 0])) as Record<HiddenLabel, number>;
const emptyTriage = (): TriageCounts => ({ judged: 0, hidden: zeroHidden(), unjudged: 0 });

/** Reads the Messenger list projection with a fixed number of project-scoped queries. */
export function messengerProjectionRepo(db: Db) {
  /**
   * The projection of the project's known chats, or of one (`only`, a row id). A fixed number of queries whatever the count: the
   * messages are scoped by a correlated EXISTS on `messenger_chats`, never one OR term per chat (P141 U2: hundreds of known chats).
   */
  const projectRows = (project: string, only?: number): MessengerProjectionRow[] => {
    const rows = db.select().from(messengerChats).where(and(eq(messengerChats.project, project), only === undefined ? undefined : eq(messengerChats.id, only))).orderBy(asc(messengerChats.id)).all();
    if (rows.length === 0) return [];
    const onlyChat = only === undefined ? sql`` : sql` and c.id = ${only}`;
    const chatPredicate = sql`exists (select 1 from messenger_chats c where c.project = messenger_messages.project and c.channel = messenger_messages.channel and c.chat_id = messenger_messages.chat_id${onlyChat})`;
    const messageWhere = and(eq(messengerMessages.project, project), chatPredicate);
      const aggregates = db
        .select({
          channel: messengerMessages.channel,
          chatId: messengerMessages.chatId,
          inbound: sql<number>`coalesce(sum(case when ${messengerMessages.direction} = 'in' then 1 else 0 end), 0)`,
          stored: sql<number>`count(*)`,
          lastInAt: sql<string | null>`max(case when ${messengerMessages.direction} = 'in' then ${messengerMessages.sentAt} end)`,
          lastOutAt: sql<string | null>`max(case when ${messengerMessages.direction} = 'out' then ${messengerMessages.sentAt} end)`,
        })
        .from(messengerMessages)
        .where(messageWhere)
        .groupBy(messengerMessages.channel, messengerMessages.chatId)
        .all();
      const latest = db.$client
        .prepare(
          `select m.id, m.project, m.channel, m.account, m.chat_id as chatId, m.remote_message_id as remoteMessageId,
             m.direction, m.kind, m.text, m.sent_at as sentAt, m.retain_until as retainUntil, m.source, m.created_at as createdAt
           from messenger_messages m
           join messenger_chats c on c.project = m.project and c.channel = m.channel and c.chat_id = m.chat_id
           where c.project = ? and (? is null or c.id = ?)
             and not exists (
               select 1 from messenger_messages newer
               where newer.project = m.project
                 and newer.channel = m.channel
                 and newer.chat_id = m.chat_id
                 and (newer.sent_at > m.sent_at or (newer.sent_at = m.sent_at and newer.id > m.id))
             )`,
        )
        .all(project, only ?? null, only ?? null) as MessengerMessageRow[];
      const drafts = db
        .select()
        .from(messengerDrafts)
        .where(and(eq(messengerDrafts.project, project), eq(messengerDrafts.status, "draft")))
        .orderBy(desc(messengerDrafts.id))
        .all();
      const identities = db
        .select({ clientId: clientIdentifiers.clientId, kind: clientIdentifiers.kind, value: clientIdentifiers.value, id: clients.id, name: clients.name, email: clients.email, notionPageId: clients.notionPageId })
        .from(clientIdentifiers)
        .innerJoin(clients, eq(clients.id, clientIdentifiers.clientId))
        .where(and(eq(clientIdentifiers.project, project), eq(clients.project, project)))
        .all();
      const notionRows = db
        .select({ email: inboxRows.email, notionPageId: inboxRows.notionPageId, notionUrl: inboxRows.notionUrl })
        .from(inboxRows)
        .where(eq(inboxRows.project, project))
        .all();
      const triageRows = db
        .select({ channel: messengerMessages.channel, chatId: messengerMessages.chatId, verdict: messengerTriage.verdict, n: sql<number>`count(*)` })
        .from(messengerTriage)
        .innerJoin(messengerMessages, eq(messengerMessages.id, messengerTriage.messageId))
        .where(and(eq(messengerTriage.project, project), messageWhere))
        .groupBy(messengerMessages.channel, messengerMessages.chatId, messengerTriage.verdict)
        .all();
      const latestVerdicts = latest.length
        ? db
            .select({ messageId: messengerTriage.messageId, verdict: messengerTriage.verdict })
            .from(messengerTriage)
            .where(and(eq(messengerTriage.project, project), inArray(messengerTriage.messageId, latest.map((message) => message.id))))
            .all()
        : [];

      const activityByChat = new Map(aggregates.map((item) => [chatKey(item.channel, item.chatId), { inbound: Number(item.inbound), lastInAt: item.lastInAt ?? null, lastOutAt: item.lastOutAt ?? null, stored: Number(item.stored) }]));
      const lastByChat = new Map(latest.map((message) => [chatKey(message.channel, message.chatId), message]));
      const lastVerdictByMessage = new Map(latestVerdicts.map((item) => [item.messageId, item.verdict]));
      const draftByChat = new Map<string, MessengerDraftRow>();
      for (const draft of drafts) {
        const key = chatKey(draft.channel, draft.chatId);
        if (!draftByChat.has(key)) draftByChat.set(key, draft);
      }
      const clientByIdentifier = new Map(identities.map((identity) => [`${identity.kind}:${identity.value}`, { id: identity.id, name: identity.name, email: identity.email, notionPageId: identity.notionPageId }]));
      const clientByChat = new Map(
        rows.flatMap((chat) => {
          const client = clientByIdentifier.get(`${linkKindOf(chat.channel)}:${chat.chatId}`);
          return client ? [[chatKey(chat.channel, chat.chatId), client] as const] : [];
        }),
      );
      const notionByEmail = new Map(notionRows.map((item) => [item.email.trim().toLowerCase(), { notionPageId: item.notionPageId, notionUrl: item.notionUrl }]));
      const triageByChat = new Map<string, TriageCounts>();
      for (const item of triageRows) {
        const key = chatKey(item.channel, item.chatId);
        const current = triageByChat.get(key) ?? emptyTriage();
        const n = Number(item.n);
        if (item.verdict === "unjudged") current.unjudged += n;
        else current.judged += n;
        if (isHiddenLabel(item.verdict)) current.hidden[item.verdict] += n;
        triageByChat.set(key, current);
      }

      return rows.map((row) => {
        const key = chatKey(row.channel, row.chatId);
        const linked = clientByChat.get(key) ?? null;
        const client = linked ? { id: linked.id, name: linked.name, email: linked.email } : null;
        return {
          row,
          client,
          // The card the client row names (P141 C1), else the inbox's record of its address.
          notion: linked ? (linked.email ? notionByEmail.get(linked.email.trim().toLowerCase()) : undefined) ?? (linked.notionPageId ? { notionPageId: linked.notionPageId, notionUrl: null } : null) : null,
          activity: activityByChat.get(key) ?? { inbound: 0, lastInAt: null, lastOutAt: null },
          stored: activityByChat.get(key)?.stored ?? 0,
          last: lastByChat.get(key) ?? null,
          lastVerdict: lastByChat.get(key) ? lastVerdictByMessage.get(lastByChat.get(key)!.id) ?? null : null,
          draft: draftByChat.get(key) ?? null,
          triage: triageByChat.get(key) ?? emptyTriage(),
        };
      });
  };
  return {
    /** Every known chat of the project, linked or not (`client` null when not). */
    async list(slug: string): Promise<MessengerProjectionRow[]> {
      return projectRows(slug);
    },
    /** One known chat by its row id (a pane opening one chat reads one, not the whole list), or null when it is not this project's. */
    async projectChat(slug: string, id: number): Promise<MessengerProjectionRow | null> {
      return projectRows(slug, id)[0] ?? null;
    },
  };
}
