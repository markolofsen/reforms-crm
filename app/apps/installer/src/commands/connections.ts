import * as p from "@clack/prompts";
import { readFileSync } from "node:fs";
import { UsageError } from "../term";
import { connectionsReport, connectionsTable, storeNamedToken, TOKEN_NAMES } from "../connections-command";
import { addConnector, listConnectors, stateAccount } from "../connectors-command";
import { ctxOf, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the connection commands: token, connections, connectors. */
export function register(program: Command): void {
  program.command("token").description("Optional: store the Notion integration token or the Telegram bot token in state/secrets/ (git-ignored, mode 600). Value comes from a hidden prompt or stdin.")
    .argument("<name>", TOKEN_NAMES.join(" or "))
    .action(async (name: string) => {
      const known = TOKEN_NAMES.find((n) => n === name);
      if (!known) throw new UsageError(`name must be ${TOKEN_NAMES.join(" or ")}`);
      const ctx = ctxOf();
      let value: string;
      if (process.stdin.isTTY) {
        const v = await p.password({ message: `Paste the ${known} token (hidden)` });
        if (p.isCancel(v)) return;
        value = v;
      } else value = readFileSync(0, "utf8");
      console.log(`stored ${storeNamedToken(ctx, known, value)} (mode 600)`);
      if (known === "telegram") console.log("a new bot token applies on the next server start");
    });

  program.command("connections").description("List the instance's connections (Notion token, Telegram bot) as the admin's Settings ▸ Connections shows them. Reads files only; prints no secret.")
    .option("--test", "also test each stored token with the provider (network; read-only)")
    .action(async (o: { test?: boolean }) => {
      const ctx = ctxOf();
      const rep = await connectionsReport(ctx, { test: !!o.test, deps: { fetch: ctx.fetch } });
      console.log(connectionsTable(rep));
      done(rep.exitCode);
    });

  const connectors = program.command("connectors").description("The instance's Google connectors (P62): Calendar and Drive servers a project attaches in its project.md. `list` reads; `add` and `account` are the owner's (a session is denied them). @docs/core/26-capabilities.md");
  connectors.command("list").description("Each connector: service, Google account (stated or read by a session), the projects that attach it.")
    .action(() => { console.log(listConnectors(ctxOf().paths)); });
  connectors.command("add").description("Add a Google-hosted connector to config/mcp.json and .mcp.json. The OAuth client secret is never written here: Claude Code asks for it at sign-in (/mcp).")
    .argument("<kind>", "calendar | drive")
    .argument("<name>", "gcal-<label> | gdrive-<label>, one Google account each")
    .requiredOption("--client-id <id>", "the OAuth client id of your Google Cloud project (…apps.googleusercontent.com)")
    .option("--callback-port <port>", "fixed OAuth callback port, when the client's redirect URI names one")
    .option("--account <address>", "the Google account you will sign in with (a session's read confirms it)")
    .action((kind: string, name: string, o: { clientId: string; callbackPort?: string; account?: string }) => {
      const port = o.callbackPort === undefined ? undefined : Number(o.callbackPort);
      if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new UsageError(`--callback-port takes a port number, got "${o.callbackPort}"`);
      try { for (const l of addConnector(ctxOf().paths, { kind, name, clientId: o.clientId, ...(port ? { callbackPort: port } : {}), ...(o.account ? { account: o.account } : {}) })) console.log(l); }
      catch (e) { throw new UsageError((e as Error).message); }
    });
  connectors.command("account").description("State the Google account a connector is signed in to (shown in Settings ▸ Agent; a session's list_calendars replaces it).")
    .argument("<name>").argument("<address>")
    .action((name: string, address: string) => {
      try { console.log(stateAccount(ctxOf().paths, name, address)); } catch (e) { throw new UsageError((e as Error).message); }
    });
}
