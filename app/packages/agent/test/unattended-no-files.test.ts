import { describe, expect, it } from "vitest";
import { AUTOPILOT_HUB_TOOLS } from "@hub/config/autopilot";
import { FOLLOW_UP_HUB_TOOLS } from "@hub/config/follow-ups";
import { LEAD_PASS_HUB_TOOLS, MAIL_PASS_HUB_TOOLS } from "@hub/config/lead-pass";
import { autopilotArgs } from "../src/autopilot";
import { followUpArgs } from "../src/follow-up";
import { leadPassArgs } from "../src/lead-pass";

// P153 D1 (decision 0052 point 9): an unattended turn reads untrusted text (a lead's form, a client's mail or message), so it
// writes no file at all, and in particular not `<home>/packages/**` (a watch lens is code the server runs) nor a project's
// `watch.md` (they reload while the server runs). Every kind has no built-in tool (`--tools ""`) and only its bound hub tools.

const files = { settings: "/s.json", mcp: "/m.json", skill: "/k.md" };
const toolsArg = (args: string[]) => args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2);

/**
 * The hub tools an unattended kind may hold, each read as writing no file of the instance: they read the database, Notion or
 * Mail, or write a database row, a Mail draft or a Notion property. A tool added to a kind fails here until it is reviewed.
 */
const REVIEWED_NO_FILE_TOOLS: readonly string[] = [
  "client_show", "client_map", "message_show", "messenger_history", "knowledge_search", "knowledge_get", "link_fetch",
  "draft_write", "messenger_draft_write", "lead_decide", "mail_decide", "follow_up_plan", "conversation_done", "bug_report",
];
/** Claude Code's built-in tools that write files or run commands; an unattended kind may name none of them. */
const BUILT_IN_WRITERS = ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "Task"];

describe("an unattended turn writes no file (P153 D1)", () => {
  it.each<[string, string[]]>([
    ["autopilot", autopilotArgs(files)],
    ["lead pass", leadPassArgs(files, undefined, undefined, "lead")],
    ["mail pass", leadPassArgs(files, undefined, undefined, "mail")],
    ["follow-up sweep", followUpArgs(files)],
  ])("%s: no built-in tool", (_kind, args) => {
    expect(toolsArg(args)).toEqual(["--tools", ""]);
    for (const t of BUILT_IN_WRITERS) expect(args.join(" ")).not.toMatch(new RegExp(`allowedTools=[^ ]*\\b${t}\\b`));
  });

  it.each<[string, readonly string[]]>([
    ["autopilot", AUTOPILOT_HUB_TOOLS],
    ["lead pass", LEAD_PASS_HUB_TOOLS],
    ["mail pass", MAIL_PASS_HUB_TOOLS],
    ["follow-up sweep", FOLLOW_UP_HUB_TOOLS],
  ])("%s: none of its hub tools writes a file", (_kind, tools) => {
    for (const t of tools) {
      expect(REVIEWED_NO_FILE_TOOLS, t).toContain(t);
      expect(BUILT_IN_WRITERS).not.toContain(t);
    }
  });
});
