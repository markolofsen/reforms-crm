import { clientMatchesDto, messengerChatDto, messengerChatsDto, messengerDraftDto, messengerSkippedDto, type ChatRulesBody, type MessengerChannelFilter, type MessengerView } from "@hub/contract/messenger-panel";
import { autolinkHiddenDto, autolinkLinkedDto, autolinkRecordsDto, autolinkStateDto, chatUnlinkedDto } from "@hub/contract/messengers";
import { read } from "../client";

const at = (project: string) => `/api/projects/${encodeURIComponent(project)}/messengers`;

/**
 * The Messengers panel (P71 M3): the linked chats with what is owed and the agent's open draft of each, the owner's Edit, Skip and
 * its Undo, one chat's rules, and the client lookup of the link picker. Reads only `messenger_drafts` and the linked chats: Mail
 * drafts are Mail's. The writes pass the server's admin gate (this page's own Origin). Nothing here sends: the send door is `./send.ts`.
 */
export const messengersApi = {
  chats: (project: string, filter: MessengerView, channel: MessengerChannelFilter = "all") => read(messengerChatsDto, { method: "GET", path: `${at(project)}/chats`, query: { filter, channel } }),
  editDraft: (project: string, id: number, text: string) => read(messengerDraftDto, { method: "PUT", path: `${at(project)}/drafts/${id}/text`, body: { text } }),
  skipDraft: (project: string, id: number) => read(messengerSkippedDto, { method: "POST", path: `${at(project)}/drafts/${id}/skip`, body: {} }),
  restoreDraft: (project: string, id: number) => read(messengerDraftDto, { method: "POST", path: `${at(project)}/drafts/${id}/restore`, body: {} }),
  setRules: (project: string, chatId: number, patch: ChatRulesBody) => read(messengerChatDto, { method: "PUT", path: `${at(project)}/chats/${chatId}/rules`, body: patch }),
  findClients: (project: string, q: string) => read(clientMatchesDto, { method: "GET", path: `${at(project)}/clients`, query: { q } }),
  // P84: the autolink. Every call is a gated POST: the state names the owner's own contacts and the records come from his Notion.
  autolinkState: (project: string) => read(autolinkStateDto, { method: "POST", path: `${at(project)}/autolink/state`, body: {} }),
  findRecords: (project: string, q: string) => read(autolinkRecordsDto, { method: "POST", path: `${at(project)}/autolink/records`, body: { q } }),
  linkRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; key: string; title?: string }) => read(autolinkLinkedDto, { method: "POST", path: `${at(project)}/autolink/link`, body }),
  // P100: nobody in Notion matches: one Clients card from the chat (Name, Email, its username or number), then the link.
  createRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title?: string; name: string; email: string }) =>
    read(autolinkLinkedDto, { method: "POST", path: `${at(project)}/autolink/create`, body }),
  // P84c: Hide ("not a client") and Unhide of an unlinked chat; the server keeps a keyed hash, never the chat.
  hideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => read(autolinkHiddenDto, { method: "POST", path: `${at(project)}/autolink/hide`, body }),
  unhideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => read(autolinkHiddenDto, { method: "POST", path: `${at(project)}/autolink/unhide`, body }),
  unlinkChat: (project: string, id: number, never: boolean) => read(chatUnlinkedDto, { method: "POST", path: `${at(project)}/chats/${id}/${never ? "never" : "unlink"}`, body: {} }),
};
