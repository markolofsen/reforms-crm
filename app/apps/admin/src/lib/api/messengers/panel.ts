import { addChatClientEmail, changeChatClient, createChatRecord, createMessengerDraft, dropHideProposals, editMessengerDraft, findAutolinkRecords, getAutolinkState, getMessengerConversation, hideChat, linkChatRecord, listAccountDialogs, listMessengerChats, markMessengerChatDone, neverLinkChat, prepareMessengerReply, restoreMessengerDraft, setMessengerChatRules, skipMessengerDraft, undoChatClient, undoMessengerChatDone, unhideChat, unlinkChat } from "@hub/api";
import { messengerChatDoneDto, messengerChatDto, messengerChatsDto, messengerConversationDto, messengerDraftDto, messengerSkippedDto, type ChatRulesBody, type MessengerChatsQuery } from "@hub/contract/messenger-panel";
import { chatEmailDto, autolinkProposalsDroppedDto, autolinkHiddenDto, autolinkLinkedDto, autolinkRecordsDto, autolinkStateDto, chatMovedDto, chatMoveUndoneDto, chatUnlinkedDto, userDialogsDto } from "@hub/contract/messengers";
import { readGenerated } from "../client";

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
  /** P143 D2: No reply needed on a chat (it leaves Needs you until their next message) and its Undo. */
  markDone: (project: string, chatId: number) => readGenerated(markMessengerChatDone(project, chatId), messengerChatDoneDto),
  undoDone: (project: string, chatId: number) => readGenerated(undoMessengerChatDone(project, chatId), messengerChatDoneDto),
  prepareReply: (project: string, chatId: number) => readGenerated(prepareMessengerReply(project, chatId, { ownerRequest: "The owner asked to prepare a reply from the Messenger panel." }), messengerChatDto),
  setRules: (project: string, chatId: number, patch: ChatRulesBody) => readGenerated(setMessengerChatRules(project, chatId, patch), messengerChatDto),
  // P84: the autolink. Every call is a gated POST: the state names the owner's own contacts and the records come from his Notion.
  autolinkState: (project: string) => readGenerated(getAutolinkState(project), autolinkStateDto),
  findRecords: (project: string, q: string) => readGenerated(findAutolinkRecords(project, { q }), autolinkRecordsDto),
  linkRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; key: string; title?: string }) => readGenerated(linkChatRecord(project, body), autolinkLinkedDto),
  // P100: nobody in Notion matches: one Clients card from the chat (Name, Email, its username or number), then the link.
  createRecord: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title?: string; name: string; email?: string }) =>
    readGenerated(createChatRecord(project, body), autolinkLinkedDto),
  // P102: one account's dialogs marked against the picked record (Link a chat…), Change client and its Undo.
  dialogsOf: (project: string, body: { channel: "telegram_user" | "whatsapp"; account: string; key: string }) => readGenerated(listAccountDialogs(project, body), userDialogsDto),
  changeClient: (project: string, id: number, key: string) => readGenerated(changeChatClient(project, id, { key }), chatMovedDto),
  undoChange: (project: string, id: number, body: { clientId: number; draftId: number | null }) => readGenerated(undoChatClient(project, id, body), chatMoveUndoneDto),
  // P84c: Hide ("not a client") and Unhide of an unlinked chat; the server keeps a keyed hash, never the chat.
  hideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => readGenerated(hideChat(project, body), autolinkHiddenDto),
  unhideChat: (project: string, body: { channel: "telegram_user" | "whatsapp"; chatId: string }) => readGenerated(unhideChat(project, body), autolinkHiddenDto),
  dropProposals: (project: string, items: { channel: "telegram_user" | "whatsapp"; chatId: string }[]) => readGenerated(dropHideProposals(project, { items }), autolinkProposalsDroppedDto),
  /** P141 C4: the Email of a chat's client known only by the chat; an address another client has merges the two. */
  addClientEmail: (project: string, id: number, email: string) => readGenerated(addChatClientEmail(project, id, { email }), chatEmailDto),
  unlinkChat: (project: string, id: number, never: boolean) => readGenerated((never ? neverLinkChat : unlinkChat)(project, id), chatUnlinkedDto),
};
