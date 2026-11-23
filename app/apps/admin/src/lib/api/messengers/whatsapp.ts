import { getWhatsAppStatus } from "@hub/api";
import { userDisconnectedDto, userLoginCancelledDto, waConnectStartedDto, waConnectStepDto, whatsappStatusDto } from "@hub/contract/messengers";
import { read, readGenerated } from "../client";

/**
 * The owner's WhatsApp linked device (P71 M5's routes, decision 0036 point 4), driven by Messengers ▸ Settings: its state, Connect
 * (only on his click: the server opens a pairing and the state carries the QR code as module rows, never the string), the pairing's
 * state and cancel, Disconnect. Every write is a POST behind the server's admin gate.
 */
export const whatsappApi = {
  status: () => readGenerated(getWhatsAppStatus(), whatsappStatusDto),
  connect: () => read(waConnectStartedDto, { method: "POST", path: "/api/messengers/whatsapp/connect", body: {} }),
  state: (flow: string) => read(waConnectStepDto, { method: "POST", path: "/api/messengers/whatsapp/connect/state", body: { flow } }),
  cancel: (flow: string) => read(userLoginCancelledDto, { method: "POST", path: "/api/messengers/whatsapp/connect/cancel", body: { flow } }),
  disconnect: (account: string) => read(userDisconnectedDto, { method: "POST", path: `/api/messengers/whatsapp/${encodeURIComponent(account)}/disconnect`, body: {} }),
};
