import { createMessengerDraft, editMessengerDraft, getMessengerConversation, listMessengerChats, prepareMessengerReply, restoreMessengerDraft, setMessengerChatRules, skipMessengerDraft } from "@hub/api";
import { messengerChatDto, messengerChatsDto, messengerConversationDto, messengerDraftDto, messengerSkippedDto, type ChatRulesBody, type MessengerChatsQuery } from "@hub/contract/messenger-panel";
import { autolinkProposalsDroppedDto, autolinkHiddenDto, autolinkLinkedDto, autolinkRecordsDto, autolinkStateDto, chatMovedDto, chatMoveUndoneDto, chatUnlinkedDto, userDialogsDto } from "@hub/contract/messengers";
import { read, readGenerated } from "../client";

const at = (project: string) => `/api/projects/${encodeURIComponent(project)}/messengers`;
type MessengerChatsInput = Pick<MessengerChatsQuery, "filter"> & Partial<Pick<MessengerChatsQuery, "link" | "channel" | "q">>;

/**
 * The Messengers panel (P71 M3): the linked chats with what is owed and the agent's open draft of each, the owner's Edit, Skip and
 * its Undo, one chat's rules, and (P102) Change client with its Undo. Reads only `messenger_drafts` and the linked chats: Mail
 * drafts are Mail's. Manual draft creation and the other writes pass the server's admin gate (this page's own Origin). Nothing
 * here sends: the send door is `./send.ts`.
 */
export const messengersApi = {
  chats: (project: string, input: MessengerChatsInput) => {
    const query: MessengerChatsQuery = { filter: input.filter, link: input.link ?? "any", channel: input.channel ?? "all", q: input.q ?? "" };
    return readGenerated(listMessengerChats(project, query), messengerChatsDto);
  },
  conversation: (project: string, chatId: number) => readGenerated(getMessengerConversation(project, chatId), messengerConversationDto),
  createManualDraft: (project: string, chatId: number, text: string) => readGenerated(createMessengerDraft(project, chatId, { text }), messengerChatDto),
  editDraft: (project: string, id: number, text: string) => readGenerated(editMessengerDraft(project, id, { text }), messengerDraftDto),
  skipDraft: (project: string, id: number) => readGenerated(skipMessengerDraft(project, id), messengerSkippedDto),
  restoreDraft: (project: string, id: number) => readGenerated(restoreMessengerDraft(project, id), messengerDraftDto),
  prepareReply: (project: string, chatId: number) => readGenerated(prepareMessengerReply(project, chatId, { ownerRequest: "The owner asked to prepare a reply from the Messenger panel." }), messengerChatDto),
  setRules: (project: string, chatId: number, patch: ChatRulesBody) => readGenerated(setMessengerChatRules(project, chatId, patch), messengerChatDto),
  // P84: the autolink. Every call is a gated POST: the state names the owner's own contacts and the records come from his Notion.
  autolinkState: (project: string) => read(autolinkStateDto, { method: "POST", path: `${at(project)}/autolink/state`, body: {} }),
  findRecords: (project: string, q: string) => read(autolinkRecordsDto, { method: "POST", path: `${at(project)}/autolink/records`, body: { q } }),
  linkRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; key: string; title?: string }) => read(autolinkLinkedDto, { method: "POST", path: `${at(project)}/autolink/link`, body }),
  // P100: nobody in Notion matches: one Clients card from the chat (Name, Email, its username or number), then the link.
  createRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title?: string; name: string; email: string }) =>
    read(autolinkLinkedDto, { method: "POST", path: `${at(project)}/autolink/create`, body }),
  // P102: one account's dialogs marked against the picked record (Link a chat…), Change client and its Undo.
  dialogsOf: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; key: string }) => read(userDialogsDto, { method: "POST", path: `${at(project)}/autolink/dialogs`, body }),
  changeClient: (project: string, id: number, key: string) => read(chatMovedDto, { method: "POST", path: `${at(project)}/chats/${id}/client`, body: { key } }),
  undoChange: (project: string, id: number, body: { clientId: number; draftId: number | null }) => read(chatMoveUndoneDto, { method: "POST", path: `${at(project)}/chats/${id}/client/undo`, body }),
  // P84c: Hide ("not a client") and Unhide of an unlinked chat; the server keeps a keyed hash, never the chat.
  hideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => read(autolinkHiddenDto, { method: "POST", path: `${at(project)}/autolink/hide`, body }),
  unhideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => read(autolinkHiddenDto, { method: "POST", path: `${at(project)}/autolink/unhide`, body }),
  dropProposals: (project: string, items: { channel: "telegram_user" | "whatsapp"; chatId: string }[]) => read(autolinkProposalsDroppedDto, { method: "POST", path: `${at(project)}/autolink/proposals/drop`, body: { items } }),
  unlinkChat: (project: string, id: number, never: boolean) => read(chatUnlinkedDto, { method: "POST", path: `${at(project)}/chats/${id}/${never ? "never" : "unlink"}`, body: {} }),
};
