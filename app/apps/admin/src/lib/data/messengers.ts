"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ChatRulesBody, MessengerChatsQuery } from "@hub/contract/messenger-panel";
import type { LiveTopic } from "@hub/contract/live";
import type { MessengerSendPreviewDto } from "@hub/contract/messenger";
import type { AutolinkLinkedDto, AutolinkRecordDto, ChatMovedDto, UserLoginStartBody, WaConnectStepDto } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { messengerSendApi } from "@/lib/api/messengers/send";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";
import { useCommand, useRefreshTopics } from "@/lib/cache/topics";
import { useSendDoor } from "./send-door";

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

// ---- One chat, its drafts and its moves (P127 C2's data half: `messengerMutationKeys` is gone, a write names `messengers`)

/** A Messengers write moves the panel's lists, the open conversation and the autolink's memory (all under `messenger-chats`). */
const MESSENGERS: readonly LiveTopic[] = ["messengers"];
type UserChannel = "telegram_user" | "whatsapp";
type Linkable = { channel: UserChannel; account: string; chatId: string; title: string };

/** One linked chat's conversation: the messages, the open draft and the reply policy (P106). */
export const useMessengerConversation = (project: string, chatId: number) => useQuery({ queryKey: keys.messengerConversation(project, chatId), queryFn: () => messengersApi.conversation(project, chatId) });

/** Prepare reply (the agent drafts one, nothing is sent). The chat is the variable, so a pending Prepare of another chat never shows here. */
export const usePrepareReply = (project: string) => useCommand({ project, touches: MESSENGERS, run: (chatId: number) => messengersApi.prepareReply(project, chatId) });

/** The owner's own words as an unsent draft of the chat (never sent here). */
export const useManualMessengerDraft = (project: string, chatId: number, onSuccess: () => void) => useCommand({ project, touches: MESSENGERS, run: (text: string) => messengersApi.createManualDraft(project, chatId, text), onSuccess });

/** Edit, Skip and its Undo (Restore) of a messenger draft (P71 M3). Send is not here: it is the door's (`useMessengerSendFlow`). */
export function useMessengerDraftCommands(project: string, on: { onSuccess: () => void; onError: (e: unknown) => void; onSkipped: (v: { id: number; name: string }) => void }) {
  const o = { project, touches: MESSENGERS, onError: on.onError };
  return {
    edit: useCommand({ ...o, run: ({ id, text }: { id: number; text: string }) => messengersApi.editDraft(project, id, text), onSuccess: on.onSuccess }),
    restore: useCommand({ ...o, run: (id: number) => messengersApi.restoreDraft(project, id), onSuccess: on.onSuccess }),
    skip: useCommand({
      ...o,
      run: ({ id }: { id: number; name: string }) => messengersApi.skipDraft(project, id),
      onSuccess: (_r, v) => {
        on.onSuccess();
        on.onSkipped(v);
      },
    }),
  };
}

/**
 * Send of one messenger draft (P71 M4, decision 0046) through the one door Mail's card uses (`send-door.ts`): the dry run, then the
 * apply with the chat and the exact text the owner read. Afterwards the panel and Activity ▸ Sends are read again.
 */
export function useMessengerSendFlow(project: string, draftId: number, sent: (p: MessengerSendPreviewDto) => void) {
  const refresh = useRefreshTopics(project);
  return useSendDoor<MessengerSendPreviewDto>({
    preview: () => messengerSendApi.preview(project, draftId),
    send: (p) => messengerSendApi.send(project, draftId, { chatId: p.chatId, text: p.text }),
    sent,
    settle: () => refresh(["messengers", "sends"]),
  });
}

/**
 * P102: the moves of a chat between its states (`features/messengers/status/use-moves.ts` keeps the toasts): Link, Change client
 * and its Undo, Unlink. `unlinkAgain` is Link's Undo (the row id is known only once linked, so the panel is read for it).
 */
export function useChatMoveCommands(project: string, on: { onError: (e: unknown) => void; onUnlinked: (v: { never: boolean; name: string }) => void; onLinked: (res: AutolinkLinkedDto, v: Linkable) => void; onChanged: (r: ChatMovedDto, v: { id: number; name: string }) => void }) {
  const refresh = useRefreshTopics(project);
  const o = { project, touches: MESSENGERS, onError: on.onError };
  const unlinkAgain = async (c: Pick<Linkable, "channel" | "chatId">) => {
    const linked = await messengersApi.chats(project, { filter: "all", link: "linked" });
    const row = linked.chats.find((x) => x.chatId === c.chatId && x.channel === c.channel);
    if (row) await messengersApi.unlinkChat(project, row.id, false);
    await refresh(MESSENGERS);
  };
  return {
    unlink: useCommand({ ...o, run: ({ id, never }: { id: number; never: boolean; name: string }) => messengersApi.unlinkChat(project, id, never), onSuccess: (_r, v) => on.onUnlinked(v) }),
    link: useCommand({
      ...o,
      run: ({ rec, ...c }: Linkable & { rec: Pick<AutolinkRecordDto, "key"> }) => messengersApi.linkRecord(project, { channel: c.channel, account: c.account, chatId: c.chatId, key: rec.key, title: c.title }),
      onSuccess: (res, v) => on.onLinked(res, v),
    }),
    undoChange: useCommand({ ...o, run: ({ id, clientId, draftId }: { id: number; clientId: number; draftId: number | null }) => messengersApi.undoChange(project, id, { clientId, draftId }) }),
    change: useCommand({ ...o, run: ({ id, key }: { id: number; key: string; name: string }) => messengersApi.changeClient(project, id, key), onSuccess: (r, v) => on.onChanged(r, v) }),
    unlinkAgain,
    refresh: () => refresh(MESSENGERS),
  };
}

type HiddenChat = { channel: UserChannel; chatId: string; title: string };

/** Hide ("not a client", P84c) and Unhide of an unlinked chat; the server keeps a keyed hash of the chat, never the chat. */
export function useHideCommands(project: string, on: { onError: (e: unknown) => void; onHidden: (c: HiddenChat) => void; onUnhidden: (c: HiddenChat) => void }) {
  const o = { project, touches: MESSENGERS, onError: on.onError };
  return {
    hide: useCommand({ ...o, run: (c: HiddenChat) => messengersApi.hideChat(project, { channel: c.channel, chatId: c.chatId }), onSuccess: (_r, c) => on.onHidden(c) }),
    unhide: useCommand({ ...o, run: (c: HiddenChat) => messengersApi.unhideChat(project, { channel: c.channel, chatId: c.chatId }), onSuccess: (_r, c) => on.onUnhidden(c) }),
  };
}

/** P102: each account's dialogs marked against the picked record (Link a chat…), read on demand and never stored. */
export const useDialogsOf = (project: string, accounts: readonly { channel: UserChannel; account: string }[], key: string | null) =>
  useQueries({
    queries: accounts.map((a) => ({
      queryKey: keys.autolinkDialogs(project, a.channel, a.account, key ?? ""),
      queryFn: () => messengersApi.dialogsOf(project, { channel: a.channel, account: a.account, key: key ?? "" }),
      enabled: key !== null,
      gcTime: 0,
      retry: false,
    })),
  });

/** P84: the Notion client records for one unlinked chat's Link (two or more characters), never kept. */
export const useRecordSearch = (project: string, term: string) =>
  useQuery({ queryKey: keys.autolinkRecords(project, term), queryFn: () => messengersApi.findRecords(project, term), enabled: term.replace(/^@/, "").length >= 2, gcTime: 0 });

/** Create a Notion client record for an unlinked chat and link it (P84). */
export const useCreateRecord = (project: string, onSuccess: (res: AutolinkLinkedDto) => void) =>
  useCommand({ project, touches: MESSENGERS, run: (body: Linkable & { name: string; email: string }) => messengersApi.createRecord(project, body), onSuccess });
