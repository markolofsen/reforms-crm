#!/usr/bin/env tsx
// `pnpm --filter @hub/messengers messengers <command>`. Commands that link or list need a person at a terminal (stdin is a
// TTY): an agent running this through a non-interactive shell cannot use them. Nothing here sends: a messenger draft is sent
// only by the admin's send door (decision 0045 point 1).
import { Command } from "commander";
import { userInfo } from "node:os";
import { createRepos, openDb, type IdentifierKind, type MessengerChannel } from "@hub/db";
import { pollCommand, statusLines } from "./commands";
import { MessengersError } from "./errors";
import { allowChat, disallowChat, humanActor, linkIdentifier, unlinkIdentifier, type HumanActor } from "./human";
import { purgeNow } from "./purge";
import { readBotToken, botTokenFile } from "./token";
import { telegramAdapterFromToken } from "./telegram-api";

const KINDS = ["email", "telegram", "phone", "whatsapp"] as const;
const CHANNELS = ["telegram_bot", "telegram_user", "whatsapp"] as const;

function person(): HumanActor {
  if (!process.stdin.isTTY) {
    throw new MessengersError("not_human", "not_human: this command needs the owner at a terminal (stdin is not a TTY)");
  }
  return humanActor(userInfo().username);
}

const program = new Command("messengers").description("Messengers in the local CRM (Telegram bot, long polling)");
program.requiredOption("-p, --project <slug>", "project slug (a registered project)");
program.option("--db <path>", "database file (default: HUB_DB or <HUB_HOME>/data/app.db)");

const withRepos = async <T>(fn: (repos: ReturnType<typeof createRepos>, project: string) => Promise<T>): Promise<T> => {
  const o = program.opts<{ project: string; db?: string }>();
  const h = openDb(o.db);
  try {
    return await fn(createRepos(h.db), o.project);
  } finally {
    h.close();
  }
};

program
  .command("link <clientId> <kind> <value>")
  .description(`link a client to an identity (${KINDS.join("|")}); a chat is also put on the allow-list`)
  .option("--channel <channel>", `for telegram: ${CHANNELS[0]} (default) or ${CHANNELS[1]}`)
  .option("--title <text>", "a label for the chat")
  .action((clientId: string, kind: string, value: string, o: { channel?: string; title?: string }) =>
    withRepos(async (repos, project) => {
      if (!KINDS.includes(kind as IdentifierKind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
      const r = await linkIdentifier(repos, person(), {
        project,
        clientId: Number(clientId),
        kind: kind as IdentifierKind,
        value,
        ...(o.channel ? { channel: o.channel as MessengerChannel } : {}),
        ...(o.title ? { title: o.title } : {}),
      });
      console.log(`linked ${kind} ${r.value} to client ${clientId}${r.allowedChannel ? `; ${r.allowedChannel} chat is on the allow-list` : ""}`);
    }),
  );

program
  .command("unlink <kind> <value>")
  .description("remove a link and take the chat off the allow-list")
  .action((kind: string, value: string) =>
    withRepos(async (repos, project) => {
      const r = await unlinkIdentifier(repos, person(), { project, kind: kind as IdentifierKind, value });
      console.log(r.removed ? `unlinked ${kind} ${value}` : `no such link: ${kind} ${value}`);
    }),
  );

program
  .command("allow <channel> <chatId>")
  .description("list a chat for inbound without linking it to a client (poll shows the ids of unlisted chats)")
  .option("--title <text>")
  .action((channel: string, chatId: string, o: { title?: string }) =>
    withRepos(async (repos, project) => {
      const id = await allowChat(repos, person(), { project, channel: channel as MessengerChannel, chatId, ...(o.title ? { title: o.title } : {}) });
      console.log(`listed ${channel} chat ${id}`);
    }),
  );

program
  .command("disallow <channel> <chatId>")
  .description("take a chat off the allow-list")
  .action((channel: string, chatId: string) =>
    withRepos(async (repos, project) => {
      console.log((await disallowChat(repos, person(), { project, channel: channel as MessengerChannel, chatId })) ? "removed" : "was not listed");
    }),
  );

program.command("status").description("polling health, allow-list, counts, drafts").action(() =>
  withRepos(async (repos, project) => {
    for (const l of await statusLines(repos, project)) console.log(l);
  }),
);

program
  .command("poll")
  .description("poll the Telegram bot; --once fetches one batch and exits")
  .option("--once", "one poll, then exit")
  .option("--token-file <path>", `bot token file (default ${botTokenFile()})`)
  .action((o: { once?: boolean; tokenFile?: string }) =>
    withRepos(async (repos, project) => {
      const adapter = telegramAdapterFromToken(await readBotToken(o.tokenFile));
      const ac = new AbortController();
      process.once("SIGINT", () => ac.abort());
      process.once("SIGTERM", () => ac.abort());
      await pollCommand({ repos, project, adapter, once: !!o.once, signal: ac.signal, log: console.log });
    }),
  );

program.command("purge").description("delete messages past their 90-day retention").action(() =>
  withRepos(async (repos) => console.log(`purged ${await purgeNow(repos)} message(s)`)),
);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
