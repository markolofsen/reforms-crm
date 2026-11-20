import { clientMatchesDto, messengerChatDto, messengerChatsDto, messengerDraftDto, messengerSkippedDto, type ChatRulesBody, type MessengerView } from "@hub/contract/messenger-panel";
import { read } from "../client";

const at = (project: string) => `/api/projects/${encodeURIComponent(project)}/messengers`;

/**
 * The Messengers panel (P71 M3): the linked chats with what is owed and the agent's open draft of each, the owner's Edit, Skip and
 * its Undo, one chat's rules, and the client lookup of the link picker. Reads only `messenger_drafts` and the linked chats: Mail
 * drafts are Drafts'. The writes pass the server's admin gate (this page's own Origin). Nothing here sends (P71 M4).
 */
export const messengersApi = {
  chats: (project: string, filter: MessengerView) => read(messengerChatsDto, { method: "GET", path: `${at(project)}/chats`, query: { filter } }),
  editDraft: (project: string, id: number, text: string) => read(messengerDraftDto, { method: "PUT", path: `${at(project)}/drafts/${id}/text`, body: { text } }),
  skipDraft: (project: string, id: number) => read(messengerSkippedDto, { method: "POST", path: `${at(project)}/drafts/${id}/skip`, body: {} }),
  restoreDraft: (project: string, id: number) => read(messengerDraftDto, { method: "POST", path: `${at(project)}/drafts/${id}/restore`, body: {} }),
  setRules: (project: string, chatId: number, patch: ChatRulesBody) => read(messengerChatDto, { method: "PUT", path: `${at(project)}/chats/${chatId}/rules`, body: patch }),
  findClients: (project: string, q: string) => read(clientMatchesDto, { method: "GET", path: `${at(project)}/clients`, query: { q } }),
};
