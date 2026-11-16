import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";
import { DENIED_TOOLS, denyRules, HUB_API_COMMANDS, enforcementArgs, guardDecision, HUB_MCP_SERVERS, writeSessionFiles } from "../src/safety.ts";

// Decision 0011: the agent gets NO send tool, in any mode. Sending is a hub command. If a rule below is removed or a
// send path is added to an agent session, one of these fails.

const ROOT = defaultRoot();
const PROJECTS = path.join(ROOT, "app", "packages", "projects", "test", "fixtures", "projects");

/** Every tool that sends, forwards or replies for real, in the connectors a session could see. */
const SEND_TOOLS = [
  "mcp__claude_ai_Gmail__send_message",
  "mcp__claude_ai_Gmail__forward",
  "mcp__claude_ai_Gmail__reply",
  "mcp__mail-mcp__create_outgoing_message", // opens a compose window that Send would complete
  "mcp__mail-mcp__replace_outgoing_message",
  "mcp__mail-mcp__replace_reply",
  "mcp__mail-mcp__delete_outgoing_message",
];

describe("the agent has no send path", () => {
  const rules = denyRules(PROJECTS, ROOT, "acme-travel");

  it.each(SEND_TOOLS)("%s stays denied (deny rule, --disallowedTools, guard)", (tool) => {
    expect(rules, "deny rule").toContain(tool);
    expect(DENIED_TOOLS, "disallowed list").toContain(tool);
    const g = guardDecision({ tool_name: tool, tool_input: {} }, { slug: "acme-travel", accounts: [], mode: "block" });
    expect(g.block, "guard blocks").toBe(true);
  });

  it("the mail programs and osascript stay denied in the agent's shell", () => {
    for (const r of ["Bash(osascript *)", "Bash(sendmail *)", "Bash(mail *)"]) expect(rules).toContain(r);
  });

  it("`hub send` is denied in every spelling, and the guard flags it", () => {
    for (const r of ["Bash(*hub send*)", "Bash(*hub.mjs send*)", "Bash(*installer/src/cli.ts send*)"]) expect(rules).toContain(r);
    for (const command of ["hub send 12 --apply", "pnpm hub send 12", "node app/apps/installer/bin/hub.mjs send 3 --apply", "hub --root /x send --due --apply", "tsx app/apps/installer/src/cli.ts send --due"]) {
      const g = guardDecision({ tool_name: "Bash", tool_input: { command } }, { slug: "acme-travel", accounts: [], mode: "block" });
      expect(g.block, command).toBe(true);
      expect(g.violations.join(), command).toMatch(/hub send/);
    }
    // ordinary hub commands are not flagged
    for (const command of ["hub record-draft --project acme-travel", "hub project show acme-travel", "hub doctor"]) {
      expect(guardDecision({ tool_name: "Bash", tool_input: { command } }, { slug: "acme-travel", accounts: [], mode: "block" }).violations, command).toEqual([]);
    }
  });

  it("the admin server's Send route is not reachable from the agent's shell or WebFetch", () => {
    for (const r of HUB_API_COMMANDS) expect(rules).toContain(r);
    expect(rules).toContain("Bash(*127.0.0.1*)");
    expect(rules).toContain("Bash(*localhost*)");
  });

  it("switching sending on is not an agent step: a write of a send.* setting is flagged", () => {
    for (const input of [{ command: "hub project set acme send.mode auto" }, { new_string: "| send.mode | auto | 2026-11-20 | agent |" }, { content: "| send.classes | client |" }, { edits: [{ new_string: "send.daily_cap | 50" }] }]) {
      const g = guardDecision({ tool_name: "Edit", tool_input: input }, { slug: "acme-travel", accounts: [], mode: "block" });
      expect(g.violations.join(), JSON.stringify(input)).toMatch(/send\.\* setting/);
    }
    expect(guardDecision({ tool_name: "Edit", tool_input: { new_string: "| tone | warm |" } }, { slug: "acme-travel", accounts: [], mode: "block" }).violations).toEqual([]);
  });

  it("the generated session files carry the deny rules and the hub's MCP servers have no send tool", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hub-sendsafe-"));
    const f = writeSessionFiles(root, PROJECTS, "acme-travel");
    const settings = JSON.parse(readFileSync(f.settings, "utf8")) as { permissions: { deny: string[]; allow?: string[] } };
    for (const t of SEND_TOOLS) expect(settings.permissions.deny).toContain(t);
    expect(settings.permissions.allow ?? []).toEqual([]);
    const args = enforcementArgs(f).join(" ");
    for (const t of SEND_TOOLS) expect(args).toContain(t);
    expect(args).toContain("--strict-mcp-config");
    expect(HUB_MCP_SERVERS).toEqual(["mail-mcp", "notion", "knowledge-mcp"]);
  });

  it("no agent module imports the sender", () => {
    const src = path.join(ROOT, "app", "apps", "installer", "src");
    for (const f of ["agent.ts", "safety.ts", "audit-run.ts", "record-draft.ts"]) expect(readFileSync(path.join(src, f), "utf8"), f).not.toMatch(/from ["'](\.\/send\/|@hub\/send)/);
    // the mail MCP server config the sessions get is read-only plus drafts: nothing in `config/mcp.json` is a send tool
    expect(readFileSync(path.join(ROOT, "config", "mcp.json"), "utf8")).not.toMatch(/send/i);
  });

  it("the only users of the real Mailer are the sender package, the send command and the server's mailer choice", () => {
    const apps = path.join(ROOT, "app");
    const users: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /mailAppMailer/.test(readFileSync(path.join(d, e.name), "utf8"))) users.push(path.relative(apps, path.join(d, e.name)));
      }
    };
    for (const sub of ["apps", "packages"]) walk(path.join(apps, sub));
    expect(users.sort()).toEqual(["apps/installer/src/send/command.ts", "apps/server/src/send/mailer.ts", "packages/send/src/mailer.ts"]);
  });
});
