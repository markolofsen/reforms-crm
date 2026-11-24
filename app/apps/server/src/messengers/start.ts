import type { Repos } from "@hub/db";
import type { StoredChat, WaAppReader } from "@hub/messengers";
import { createLlm } from "@hub/llm";
import { errFields, ops } from "@hub/log/ops";
import type { Runtime } from "../composition/runtime";
import { messengerSenders, messengerTyping } from "../send/messenger-senders";
import { messengerPolicy } from "../send/messenger-policy";
import type { AutopilotBrain } from "@hub/config/autopilot";
import { autopilotDeliver } from "./autopilot/deliver";
import { startMessengers } from "./bot";
import { startTelegramUser, type TelegramUserHandle } from "./accounts/telegram-user";
import { startWhatsApp, type WhatsAppHandle } from "./accounts/whatsapp";
import { startProjectAutolink, type ProjectAutolink } from "./autolink/setup";
import { startPurge } from "./purge";
import { createPreanalysis } from "./preanalysis";
import { createAutopilot, type AutopilotHandle } from "./autopilot/wake";
import type { AutopilotFiles } from "./autopilot/switches";

export type MessengersRuntime = {
  handles: Runtime["messengers"] & { bot: NonNullable<Runtime["messengers"]["bot"]>; telegramUser: TelegramUserHandle; whatsapp: WhatsAppHandle; autolink: ProjectAutolink; autopilot: AutopilotHandle };
  /** The pollers' state lines for the `health` live topic. */
  states: () => { state: string; reason?: string; lastError?: string | null | undefined }[];
  stop(): Promise<void>;
};

/**
 * The messengers domain at start (P126 S1): the retention purge, the pre-analysis, the bot poller, the autolink, the Telegram user
 * accounts and the WhatsApp linked devices. Each line counts accounts, never names one.
 */
export async function start({ repos, autopilotFiles, autopilotBrain, allowList = [], waAppReader }: { repos: Repos; autopilotFiles: AutopilotFiles; autopilotBrain?: AutopilotBrain | undefined; allowList?: string[]; waAppReader?: () => WaAppReader }): Promise<MessengersRuntime> {
  const log = ops("server");
  // P71 M2b: the messenger retention purge runs now and every hour, with or without a connected channel.
  const purge = startPurge({ repos });
  // P71 M-P: the pre-analysis of linked chats whose switch is on, through `@hub/llm` (the ledger is `llm_calls`). A pass runs only
  // after a poll stored messages or on the owner's click; with no OpenRouter key (and not HUB_LLM=fake) it asks nothing.
  const llm = createLlm({ ledger: repos.llmCalls });
  const preanalysis = createPreanalysis({ repos, llm });
  log.info(`pre-analysis: ${preanalysis.standing().state === "no_key" ? "off (no OpenRouter key)" : llm.transport === "fake" ? "on, FAKE MODEL (HUB_LLM=fake): nothing leaves this process" : "ready (only chats whose switch is on)"}`);
  // P139 (decision 0048): the autopilot wakes inside the same poll, on the chats it stored in. Its brain is the composition's
  // (`claude -p`, the fake of an e2e run, or none); its send is bound below, once the accounts it reaches have started.
  const autopilot = createAutopilot({ repos, files: autopilotFiles, ...(autopilotBrain ? { brain: autopilotBrain } : {}) });
  log.info(`autopilot: ${autopilotBrain ? `brain ${autopilotBrain.name}${autopilotBrain.name === "fake" ? " (HUB_AUTOPILOT_BRAIN=fake): no model" : ""}` : "no brain on this server"}; the instance switch is ${autopilot.switches.instance().value.on ? "on" : "off"}`);
  const onStored = (project: string, chats: StoredChat[]) => {
    preanalysis.after(project);
    autopilot.stored(project, chats);
  };
  // The messengers poller runs only when a bot token file exists; it only receives. Its state is part of /api/health.
  const bot = await startMessengers({ repos, onStored });
  log.info(`messengers: ${bot.status().state}${bot.status().reason ? ` (${bot.status().reason})` : ""}`);
  // P84: the autolink of chats to client records. The adapters tell it only who an unlinked chat is (never a text); the handles
  // are bound once they exist.
  const handles: { tg?: TelegramUserHandle; wa?: WhatsAppHandle } = {};
  const linker = await startProjectAutolink({
    repos,
    adapterOf: (channel, account) => (channel === "telegram_user" ? handles.tg?.adapter(account) : handles.wa?.adapter(account)),
    accounts: () => [
      ...(handles.tg?.status().accounts.filter((a) => a.state === "running").map((a) => ({ channel: "telegram_user" as const, account: a.account })) ?? []),
      ...(handles.wa?.status().accounts.filter((a) => a.state === "running").map((a) => ({ channel: "whatsapp" as const, account: a.account })) ?? []),
    ],
  });
  // P71: the Telegram user accounts, one connection per session under state/secrets/sessions/.
  const telegramUser = await startTelegramUser({
    repos,
    onStored,
    onUnlinked: (account, d, inbound) => linker.autolink.seen("telegram_user", account, d, inbound),
    hidden: (chatId) => linker.autolink.hidden("telegram_user", chatId),
    onConnected: (account) => void linker.autolink.scan("telegram_user", account).catch((e: unknown) => ops("autolink").warn("the scan of a connected Telegram account failed", { account, ...errFields(e) })),
  });
  handles.tg = telegramUser;
  const tg = telegramUser.status();
  log.info(`telegram user accounts: ${tg.state === "on" ? `${tg.accounts.length} connected` : `off (${tg.reason ?? ""})`}`);
  // P71 M5: the WhatsApp linked devices, one socket per folder under state/secrets/sessions/.
  // P141 (decision 0049): every private chat that writes is cached unless hidden, and the Mac's WhatsApp app refills a chat.
  const whatsapp = await startWhatsApp({
    repos,
    onStored,
    onUnlinked: (account, d, inbound) => linker.autolink.seen("whatsapp", account, d, inbound),
    hidden: (chatId) => linker.autolink.hidden("whatsapp", chatId),
    ...(waAppReader ? { appReader: waAppReader } : {}),
  });
  handles.wa = whatsapp;
  const wa = whatsapp.status();
  log.info(`whatsapp linked devices: ${wa.state === "on" ? `${wa.accounts.length} connected` : `off (${wa.reason ?? ""})`}`);
  const senders = messengerSenders(telegramUser, whatsapp);
  // A4: the autopilot's send goes through the same door as the owner's Send, with its own authority; typing is its own port.
  const doorPolicy = messengerPolicy({ projectsDir: autopilotFiles.projectsDir, policyDir: autopilotFiles.policyDir, allowList });
  autopilot.useDeliver(autopilotDeliver({ repos, switches: autopilot.switches, door: () => (senders ? { repos, policy: doorPolicy, senders } : null), typing: messengerTyping(telegramUser, whatsapp) }));
  // Verdict 23: what the client wrote while the Hub was off is answered (under 15 minutes) or handed back, once, at start.
  void autopilot.scan().catch((e: unknown) => ops("autopilot").error("the autopilot restart scan failed", errFields(e)));
  return {
    handles: { bot: bot.status, telegramUser, whatsapp, autolink: linker, preanalysis, reply: { llm }, autopilot, ...(senders ? { senders } : {}) },
    states: () => [bot.status(), ...telegramUser.status().accounts, ...whatsapp.status().accounts],
    stop: async () => {
      purge.stop();
      linker.stop();
      await Promise.all([bot.stop(), telegramUser.stop(), whatsapp.stop()]);
      autopilot.scheduler.cancel(() => true);
      await autopilot.idle();
    },
  };
}
