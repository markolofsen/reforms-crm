import { AUTOPILOT_HUB_TOOLS } from "@hub/config/autopilot";
import { FOLLOW_UP_HUB_TOOLS } from "@hub/config/follow-ups";
import type { ToolDef } from "../define";
import { chatsProposeHideTool, chatsUnlinkedTool } from "./chat-sort";
import { clientMapTool, mapsDueTool } from "./client-map";
import { clientRecordTool } from "./client-record";
import { chatLinkTool, clientCreateTool, conversationDoneTool } from "./conversation";
import { draftShowTool } from "./draft-show";
import { draftWriteTool } from "./draft-write";
import { focusTool, highlightTool } from "./focus";
import { followUpPlanTool, followUpsDueTool } from "./follow-ups";
import { knowledgeGetTool, knowledgeSearchTool } from "./knowledge";
import { clientShowTool, mailListTool, messageShowTool } from "./mail-read";
import { messengerDraftWriteTool, messengerHistoryTool, messengerSendTool } from "./messengers";
import { linkFetchTool } from "./link";
import { bugReportTool } from "./bug-report";
import { projectShowTool } from "./project";

// P129 A2: the one list of `hub mcp`'s tools. `HUB_MCP_TOOLS`, the README table, the capability matrix and the registry
// test read it; a new tool is one entry here and one `defineTool` in its area's file.

// P129 verdict 5 (A4): `project_show` replaced `project_notion` and `project_links`; `message_show` replaced `inbound_show`
// and `mail_brand`; `mail_list` replaced `drafts_list`; the knowledge tools moved here from the `knowledge-mcp` server.
// Owner 2026-11-25: `link_fetch` opens a public link a client sent (the session's commands have no network).
// P143: `conversation_done` (also an autopilot turn's, its own chat), `client_create` and `chat_link` (attended only, at run time).
// P145 B3: `bug_report` files a client's bug report in the project's Bug reports (every turn kind; bound like the rest).
export const TOOLS = [focusTool, highlightTool, projectShowTool, mailListTool, clientShowTool, draftShowTool, messageShowTool, draftWriteTool, clientRecordTool, clientMapTool, mapsDueTool, knowledgeSearchTool, knowledgeGetTool, messengerHistoryTool, messengerDraftWriteTool, chatsUnlinkedTool, chatsProposeHideTool, conversationDoneTool, clientCreateTool, chatLinkTool, followUpsDueTool, followUpPlanTool, linkFetchTool, bugReportTool] as const satisfies readonly ToolDef[];

/** Decision 0048 (verdict 28 as built): an autopilot turn's `hub mcp` registers exactly these, each bound to the turn's chat. */
export const AUTOPILOT_TOOLS: readonly ToolDef[] = TOOLS.filter((t) => (AUTOPILOT_HUB_TOOLS as readonly string[]).includes(t.name));

/** Decision 0050 (P142 verdict 5): a follow-up sweep turn's `hub mcp` registers exactly these, each bound to the turn's client. */
export const FOLLOW_UP_TOOLS: readonly ToolDef[] = TOOLS.filter((t) => (FOLLOW_UP_HUB_TOOLS as readonly string[]).includes(t.name));

/** Decision 0046: registered only in a session the owner started (the server's send port is passed); never in a background run. */
export const ATTENDED_TOOLS = [messengerSendTool] as const satisfies readonly ToolDef[];
