"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ChatRulesBody, MessengerChatsQuery } from "@hub/contract/messenger-panel";
import type { UserLoginStartBody, WaConnectStepDto } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";
import { useCommand } from "@/lib/cache/topics";

/**
 * P127 C2's data half (V3): Messengers' reads and writes (state rule 4b). The chats of a view, a link state, a channel and a
 * search, one key each (`keys.messengerChats`), so the sidebar's counts and an open list share a request.
 */

/** The server's linked chats under the view and link state (P123 U3b), with the View menu's counts. `keep` keeps the last list while typing. */
export const useMessengerChats = (project: string | null, query: MessengerChatsQuery, o: { keep?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.messengerChats(project ?? "", query.filter, query.link, query.channel, query.q),
    queryFn: () => messengersApi.chats(project ?? "", query),
    enabled: project !== null && (o.enabled ?? true),
    ...(o.keep ? { placeholderData: keepPreviousData } : {}),
  });

/** The server keeps the unlinked chats in memory and a new one bumps no live topic: read again this often while the screen is open (state rule 13's exception, until P126 S1). */
const AUTOLINK_POLL_MS = 15_000;

/** The autolink's memory: the unlinked and hidden chats, the directory's state. Never retried, never kept after the screen. */
export const useAutolinkState = (project: string) => useQuery({ queryKey: keys.autolink(project), queryFn: () => messengersApi.autolinkState(project), refetchInterval: AUTOLINK_POLL_MS, gcTime: 0, retry: false });

/** One linked chat's rules (P71 M2b), written by the owner only; the chat's list and conversation read them again. */
export const useSaveChatRules = (project: string, chatId: number) => useCommand({ project, touches: ["messengers"], run: (patch: ChatRulesBody) => messengersApi.setRules(project, chatId, patch) });

/** Disconnect one account of a user-account channel: the session goes, the channel's status is read again. */
export function useDisconnectAccount(channel: "telegram_user" | "whatsapp", account: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (channel === "whatsapp" ? whatsappApi.disconnect(account) : telegramUserApi.disconnect(account)),
    onSettled: () => qc.invalidateQueries({ queryKey: channel === "whatsapp" ? keys.whatsapp() : keys.telegramUser() }),
  });
}

// ---- The Telegram account (P71 M3; `features/messengers/settings/use-telegram.ts` until P127 C2's data half)

export const useTelegramUser = () => useQuery({ queryKey: keys.telegramUser(), queryFn: telegramUserApi.status });

/** Where the connect form stands: the first step, the code, the 2FA password, or done with the owner's own display name. */
export type LoginStep = { step: "start" } | { step: "code"; flow: string } | { step: "password"; flow: string } | { step: "done"; name: string };

/**
 * The connect form's steps over M1's routes (decision 0036 point 4), one call each. The flow id lives in this state only; the
 * api_hash, phone, code and password are arguments of one call and are kept nowhere (no query key, no mutation variables, no
 * address). One sentence reaches the live region: a refusal (wrong code, Telegram's answer) is an alert.
 */
export function useTelegramLogin() {
  const qc = useQueryClient();
  const [state, setState] = useState<LoginStep>({ step: "start" });
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const run = useCallback(
    async (call: () => Promise<{ step: "code" | "password"; flow: string } | { step: "done"; account: string; name: string }>) => {
      setBusy(true);
      setAlert(null);
      try {
        const r = await call();
        setState(r.step === "done" ? { step: "done", name: r.name } : { step: r.step, flow: r.flow });
        if (r.step === "done") await qc.invalidateQueries({ queryKey: keys.telegramUser() });
      } catch (e) {
        setAlert(sentence(e));
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  const start = useCallback((b: UserLoginStartBody) => run(() => telegramUserApi.start(b)), [run]);
  const code = useCallback((c: string) => (state.step === "code" ? run(() => telegramUserApi.code(state.flow, c)) : undefined), [run, state]);
  const password = useCallback((p: string) => (state.step === "password" ? run(() => telegramUserApi.password(state.flow, p)) : undefined), [run, state]);
  const cancel = useCallback(async () => {
    if (state.step === "code" || state.step === "password") await telegramUserApi.cancel(state.flow).catch(() => undefined);
    setAlert(null);
    setState({ step: "start" });
  }, [state]);
  return { state, busy, alert, start, code, password, cancel };
}

// ---- WhatsApp (P71 M5; `features/messengers/settings/whatsapp/use-whatsapp.ts` until P127 C2's data half)

export const useWhatsApp = () => useQuery({ queryKey: keys.whatsapp(), queryFn: whatsappApi.status });

/** How often the admin asks for the pairing's state while it waits: WhatsApp shows a new QR code about every 20 s. */
export const PAIRING_POLL_MS = 2000;

const ended = (s: WaConnectStepDto | undefined) => s?.step === "done" || s?.step === "failed";

/**
 * The WhatsApp Connect (decision 0036 point 4): nothing happens until the owner presses Connect; then the server opens a pairing
 * and the admin reads its state every 2 s (the QR code to scan, then done or failed) until it ends or he cancels. The server drops
 * a pairing once its end is read, so the reads stop there. The flow id lives in this state only; the QR code is never cached past
 * the pairing (`gcTime: 0`).
 */
export function useWhatsAppConnect() {
  const qc = useQueryClient();
  const [flow, setFlow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const state = useQuery({
    queryKey: keys.whatsappPairing(flow ?? ""),
    queryFn: async () => {
      const s = await whatsappApi.state(flow ?? "");
      if (s.step === "done") void qc.invalidateQueries({ queryKey: keys.whatsapp() });
      return s;
    },
    enabled: flow !== null,
    refetchInterval: (q) => (ended(q.state.data) || q.state.error ? false : PAIRING_POLL_MS),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const s = flow !== null ? state.data : undefined;

  const connect = useCallback(async () => {
    setBusy(true);
    setRefused(null);
    try {
      setFlow((await whatsappApi.connect()).flow);
    } catch (e) {
      setFlow(null);
      setRefused(sentence(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const cancel = useCallback(async () => {
    if (flow && !ended(state.data)) await whatsappApi.cancel(flow).catch(() => undefined);
    setFlow(null);
    setRefused(null);
  }, [flow, state.data]);

  const failed = s?.step === "failed" ? s.reason : flow !== null && state.isError ? sentence(state.error) : null;
  return {
    active: flow !== null && !ended(s) && !state.isError,
    qr: s?.step === "qr" ? s : null,
    busy,
    alert: refused ?? failed,
    done: s?.step === "done" ? `Linked as ${s.name || `+${s.account}`}.` : null,
    connect,
    cancel,
  };
}
