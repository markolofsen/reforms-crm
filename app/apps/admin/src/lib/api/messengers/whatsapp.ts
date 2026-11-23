import { cancelWhatsAppConnect, disconnectWhatsApp, getWhatsAppStatus, readWhatsAppConnect, startWhatsAppConnect } from "@hub/api";
import { userDisconnectedDto, userLoginCancelledDto, waConnectStartedDto, waConnectStepDto, whatsappStatusDto } from "@hub/contract/messengers";
import { readGenerated } from "../client";

/**
 * The owner's WhatsApp linked device (P71 M5's routes, decision 0036 point 4), driven by Settings ▸ Messengers: its state, Connect
 * (only on his click: the server opens a pairing and the state carries the QR code as module rows, never the string), the pairing's
 * state and cancel, Disconnect. Every write is a POST behind the server's admin gate.
 */
export const whatsappApi = {
  status: () => readGenerated(getWhatsAppStatus(), whatsappStatusDto),
  connect: () => readGenerated(startWhatsAppConnect(), waConnectStartedDto),
  state: (flow: string) => readGenerated(readWhatsAppConnect({ flow }), waConnectStepDto),
  cancel: (flow: string) => readGenerated(cancelWhatsAppConnect({ flow }), userLoginCancelledDto),
  disconnect: (account: string) => readGenerated(disconnectWhatsApp(account), userDisconnectedDto),
};
