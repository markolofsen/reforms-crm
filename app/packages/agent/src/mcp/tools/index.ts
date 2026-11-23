import type { ToolDef } from "../define";
import { draftShowTool } from "./draft-show";
import { draftWriteTool } from "./draft-write";
import { focusTool, highlightTool } from "./focus";
import { clientShowTool, draftsListTool, inboundShowTool, mailBrandTool } from "./mail-read";
import { messengerDraftWriteTool, messengerHistoryTool, messengerSendTool } from "./messengers";
import { projectLinksTool, projectNotionTool } from "./project";

// P129 A2: the one list of `hub mcp`'s tools. `HUB_MCP_TOOLS`, the README table, the capability matrix and the registry
// test read it; a new tool is one entry here and one `defineTool` in its area's file.

export const TOOLS = [focusTool, highlightTool, draftShowTool, clientShowTool, inboundShowTool, draftsListTool, mailBrandTool, projectNotionTool, projectLinksTool, draftWriteTool, messengerHistoryTool, messengerDraftWriteTool] as const satisfies readonly ToolDef[];

/** Decision 0046: registered only in an attended instance (the server's send port is passed); never unattended. */
export const ATTENDED_TOOLS = [messengerSendTool] as const satisfies readonly ToolDef[];
