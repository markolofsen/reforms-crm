import { telegramUserStatusDto, userLoginCancelledDto, userDisconnectedDto, userLoginStepDto, type UserLoginStartBody } from "@hub/contract/messengers";
import { read } from "../client";

/**
 * The owner's Telegram user account (P71 M1's routes, decision 0036 point 4), driven by Messengers ▸ Settings: its state, the
 * login one step per call (api_id and api_hash, then a phone and code or a QR code, then the 2FA password if Telegram asks), Disconnect. The api_hash, the phone, the code and the password are arguments of these calls and go nowhere else:
 * not into a query key, a mutation's variables or the address; no reply carries one (the contract has no field for it).
 */
export const telegramUserApi = {
  status: () => read(telegramUserStatusDto, { method: "GET", path: "/api/messengers/telegram-user" }),
  start: (body: UserLoginStartBody) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/start", body }),
  loginStatus: (flow: string) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/status", body: { flow } }),
  code: (flow: string, code: string) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/code", body: { flow, code } }),
  password: (flow: string, password: string) => read(userLoginStepDto, { method: "POST", path: "/api/messengers/telegram-user/login/password", body: { flow, password } }),
  cancel: (flow: string) => read(userLoginCancelledDto, { method: "POST", path: "/api/messengers/telegram-user/login/cancel", body: { flow } }),
  disconnect: (account: string) => read(userDisconnectedDto, { method: "POST", path: `/api/messengers/telegram-user/${encodeURIComponent(account)}/disconnect`, body: {} }),
};
