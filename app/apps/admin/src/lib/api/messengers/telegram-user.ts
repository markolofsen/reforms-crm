import { telegramUserStatusDto, userLoginCancelledDto, userDialogsDto, userDisconnectedDto, userLinkedDto, userLoginStepDto, type UserLoginStartBody } from "@hub/contract/messengers";
import { read } from "../client";

/**
 * The owner's Telegram user account (P71 M1's routes, decision 0036 point 4), driven by Messengers ▸ Settings: its state, the
 * login one step per call (api_id, api_hash and phone; then the code; then the 2FA password if Telegram asks), Disconnect, the
 * dialog picker and Link. The api_hash, the phone, the code and the password are arguments of these calls and go nowhere else:
 * not into a query key, a mutation's variables or the address; no reply carries one (the contract has no field for it).
 */
export const telegramUserApi = {
  status: () => read(telegramUserStatusDto, { method: "GET", path: "/api/messengers/telegram-user" }),
  start: (body: UserLoginStartBody) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/start", body }),
  code: (flow: string, code: string) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/code", body: { flow, code } }),
  password: (flow: string, password: string) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/password", body: { flow, password } }),
  cancel: (flow: string) => read(userLoginCancelledDto, { method: "POST", path: "/api/messengers/telegram-user/login/cancel", body: { flow } }),
  disconnect: (account: string) => read(userDisconnectedDto, { method: "POST", path: `/api/messengers/telegram-user/${encodeURIComponent(account)}/disconnect`, body: {} }),
  dialogs: (project: string, account: string, clientId: number) =>
    read(userDialogsDto, { method: "POST", path: `/api/projects/${encodeURIComponent(project)}/messengers/telegram-user/${encodeURIComponent(account)}/dialogs`, body: { clientId } }),
  link: (project: string, account: string, body: { clientId: number; chatId: string; title?: string }) =>
    read(userLinkedDto, { method: "POST", path: `/api/projects/${encodeURIComponent(project)}/messengers/telegram-user/${encodeURIComponent(account)}/link`, body }),
};
