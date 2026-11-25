import { operations as agent } from "../agent/openapi";
import type { Operation } from "../http/openapi";
import { operations as instance } from "../instance/openapi";
import { operations as live } from "../live/openapi";
import { operations as local } from "../local/openapi";
import { operations as mail } from "../mail/openapi";
import { operations as messengers } from "../messengers/openapi";
import { operations as overview } from "../overview/openapi";
import { operations as projects } from "../projects/openapi";
import { operations as send } from "../send/openapi";
import { operations as terminal } from "../terminal/openapi";

/** Every operation the server declares, by domain (P120 W2): the whole browser API, so the document needs no hand-kept base. */
export const OPERATIONS: readonly Operation[] = [...instance, ...overview, ...projects, ...mail, ...messengers, ...send, ...agent, ...terminal, ...local, ...live];

/**
 * The routes that are not browser operations, each with its reason: `http/openapi.test.ts` fails on a route that is neither
 * declared nor named here, so coverage is total by construction.
 */
export const NOT_DECLARED: Readonly<Record<string, string>> = {
  "post /api/projects/:slug/messengers/drafts/:id/agent-send": "the agent's send on the owner's word (decision 0046): `hub mcp` calls it with its token, the browser never",
  "post /api/projects/:slug/messengers/autolink/agent-unlinked": "the agent's `chats_unlinked` tool (P128 X5), called by `hub mcp`",
  "post /api/projects/:slug/messengers/autolink/agent-proposals": "the agent's `chats_propose_hide` tool (P128 X5), called by `hub mcp`",
  "post /api/projects/:slug/messengers/autolink/agent-create": "the agent's `client_create`, from a chat or with none (P143 L2), called by `hub mcp` in an attended session",
  "post /api/projects/:slug/messengers/autolink/agent-link": "the agent's `chat_link` (P143 L2), called by `hub mcp` in an attended session",
  "post /api/projects/:slug/lead-pass/agent-run": "the agent's `lead_pass_start` (P147 F3), called by `hub mcp` in an attended session with its token",
  "post /api/projects/:slug/mail/inbound/:id/agent-junk": "the agent's `mail_junk` (P147 3m item 1, 3n: body `to` junk or trash), called by `hub mcp` in an attended session with its token",
};
