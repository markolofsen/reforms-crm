import type { ToolDef } from "../define";
import { chatsProposeHideTool, chatsUnlinkedTool } from "./chat-sort";
import { clientMapTool } from "./client-map";
import { clientRecordTool } from "./client-record";
import { draftShowTool } from "./draft-show";
import { draftWriteTool } from "./draft-write";
import { focusTool, highlightTool } from "./focus";
import { knowledgeGetTool, knowledgeSearchTool } from "./knowledge";
import { clientShowTool, mailListTool, messageShowTool } from "./mail-read";
import { messengerDraftWriteTool, messengerHistoryTool, messengerSendTool } from "./messengers";
import { projectShowTool } from "./project";

// P129 A2: the one list of `hub mcp`'s tools. `HUB_MCP_TOOLS`, the README table, the capability matrix and the registry
// test read it; a new tool is one entry here and one `defineTool` in its area's file.

// P129 verdict 5 (A4): `project_show` replaced `project_notion` and `project_links`; `message_show` replaced `inbound_show`
// and `mail_brand`; `mail_list` replaced `drafts_list`; the knowledge tools moved here from the `knowledge-mcp` server.
export const TOOLS = [focusTool, highlightTool, projectShowTool, mailListTool, clientShowTool, draftShowTool, messageShowTool, draftWriteTool, clientRecordTool, clientMapTool, knowledgeSearchTool, knowledgeGetTool, messengerHistoryTool, messengerDraftWriteTool, chatsUnlinkedTool, chatsProposeHideTool] as const satisfies readonly ToolDef[];

/** Decision 0046: registered only in an attended instance (the server's send port is passed); never unattended. */
export const ATTENDED_TOOLS = [messengerSendTool] as const satisfies readonly ToolDef[];
