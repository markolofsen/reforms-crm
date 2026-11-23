import { messengerSendPreviewDto } from "@hub/contract/messenger";
import { sendTicketDto, sentDto } from "@hub/contract/sending";
import { createSendTicket, sendMessengerDraft } from "@hub/api";
import { readGenerated } from "../client";

/**
 * The send door for one messenger draft (P71 M4, decision 0036 point 7). `preview` sends nothing and answers exactly what would go
 * out (the chat, the account, who, the text) or every refusal in words; `send` carries the chat and the text the person saw and a
 * single-use ticket that only this page's own origin can mint, fetched just before. The server refuses it when the text changed.
 */
export const messengerSendApi = {
  preview: (project: string, draftId: number) => readGenerated(sendMessengerDraft(project, draftId, { apply: false }), messengerSendPreviewDto),
  send: async (project: string, draftId: number, confirm: { chatId: string; text: string }) => {
    const { ticket } = await readGenerated(createSendTicket({ project, draftId, kind: "messenger" }), sendTicketDto);
    return readGenerated(sendMessengerDraft(project, draftId, { apply: true, confirm, ticket }), sentDto);
  },
};
