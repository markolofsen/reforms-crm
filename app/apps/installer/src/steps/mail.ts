import { readJson } from "../context";
import type { Step } from "../types";
import { isLoaded } from "../launchctl";
import { mcpCall, mcpReachable } from "../mcp-probe";
import { fail, pass } from "./helpers";

export const mailSteps: Step[] = [
  {
    id: "mail.daemon", group: "Mail", title: "mail-mcp daemon",
    why: "Mail.app access lives in one background service (mail-mcp), so no other program needs permission to control Mail. It can create drafts and has no send tool.",
    verifies: "`localhost:8787` answers an MCP `initialize` (however mail-mcp was started).",
    async check(ctx) {
      // Reachability is what a session needs; how it was started (brew services or a terminal) does not matter.
      if (await mcpReachable(ctx, ctx.mailUrl)) return pass("running, answers on :8787");
      return fail((await isLoaded(ctx, "homebrew.mxcl.mail-mcp")) ? "loaded but does not answer on :8787" : "mail-mcp is not running on :8787 (start it: `brew services start mail-mcp`)");
    },
    manual: { steps: ["Install: `brew install dastrobu/tap/mail-mcp`.", "Start it as a service: `brew services start mail-mcp`."] },
  },
  {
    id: "mail.account", group: "Mail", title: "Mail account and permissions",
    why: "The agent reads the owner's mail through Mail.app and writes reply drafts there; it never sends.",
    verifies: "mail-mcp lists the account named in `config/config.json` and reads one message from its first mailbox.",
    manual: {
      steps: [
        "Open Mail.app and add the account (System Settings > Internet Accounts). Keep Mail.app running.",
        "Put the account's exact name in `config/config.json` (`account`) and the allowed sender addresses in `allow_list`.",
        "When macOS asks, allow `mail-mcp` to control Mail (Privacy & Security > Automation) and allow Accessibility (needed to create drafts).",
        "Full Disk Access is only needed if a tool reads `~/Library/Mail` directly; the default setup does not.",
      ],
    },
    async check(ctx) {
      const cfg = readJson(ctx.paths.configFile);
      if (!cfg?.account) return fail("`account` is empty in config/config.json");
      const acc = await mcpCall(ctx, ctx.mailUrl, "list_accounts", { enabled: true });
      if (!acc.ok) return fail(`list_accounts: ${acc.text.slice(0, 120)}`);
      if (!acc.text.includes(cfg.account)) return fail(`account "${cfg.account}" not listed by Mail`);
      const msg = await mcpCall(ctx, ctx.mailUrl, "find_messages", {
        account: cfg.account, mailboxPath: [cfg.mailboxes?.[0] ?? "INBOX"], dateAfter: new Date(Date.now() - 30 * 864e5).toISOString(), limit: 1,
      });
      return msg.ok ? pass(`account "${cfg.account}" readable`) : fail(`find_messages: ${msg.text.slice(0, 120)}`);
    },
  },
];
