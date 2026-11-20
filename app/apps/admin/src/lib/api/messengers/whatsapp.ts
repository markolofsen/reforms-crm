import { userDialogsDto, userDisconnectedDto, userLinkedDto, userLoginCancelledDto, waConnectStartedDto, waConnectStepDto, whatsappStatusDto } from "@hub/contract/messengers";
import { read } from "../client";

/**
 * The owner's WhatsApp linked device (P71 M5's routes, decision 0036 point 4), driven by Messengers ▸ Settings: its state, Connect
 * (only on his click: the server opens a pairing and the state carries the QR code as module rows, never the string), the pairing's
 * state and cancel, Disconnect, the dialog picker and Link. Every write is a POST behind the server's admin gate.
 */
export const whatsappApi = {
  status: () => read(whatsappStatusDto, { method: "GET", path: "/api/messengers/whatsapp" }),
  connect: () => read(waConnectStartedDto, { method: "POST", path: "/api/messengers/whatsapp/connect", body: {} }),
  state: (flow: string) => read(waConnectStepDto, { method: "POST", path: "/api/messengers/whatsapp/connect/state", body: { flow } }),
  cancel: (flow: string) => read(userLoginCancelledDto, { method: "POST", path: "/api/messengers/whatsapp/connect/cancel", body: { flow } }),
  disconnect: (account: string) => read(userDisconnectedDto, { method: "POST", path: `/api/messengers/whatsapp/${encodeURIComponent(account)}/disconnect`, body: {} }),
  dialogs: (project: string, account: string, clientId: number) =>
    read(userDialogsDto, { method: "POST", path: `/api/projects/${encodeURIComponent(project)}/messengers/whatsapp/${encodeURIComponent(account)}/dialogs`, body: { clientId } }),
  link: (project: string, account: string, body: { clientId: number; chatId: string; title?: string }) =>
    read(userLinkedDto, { method: "POST", path: `/api/projects/${encodeURIComponent(project)}/messengers/whatsapp/${encodeURIComponent(account)}/link`, body }),
};
