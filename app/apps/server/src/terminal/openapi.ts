import { okDto } from "@hub/contract/responses";
import { createSessionBody, DROP_FIELD, ensureSessionBody, ensureSessionDto, terminalDropDto, terminalSessionDto, terminalStateDto, terminalTicketBody, terminalTicketDto } from "@hub/contract/terminal";
import type { Operation } from "../http/openapi";

/**
 * The terminal's JSON lifecycle (P120 W2). The protocol stays the terminal adapter's (rules 12): `lib/api/terminal.ts` owns the
 * sessions, the single-use ticket and the socket; a drop is a multipart form, posted at its operation's URL.
 */
export const operations: Operation[] = [
  { method: "get", path: "/api/terminal", operationId: "getTerminal", summary: "Read the terminal's sessions and facts", tags: ["terminal"], reply: { name: "TerminalState", schema: terminalStateDto }, errors: [403, 503] },
  { method: "post", path: "/api/terminal/sessions", operationId: "createTerminalSession", summary: "Start one terminal session", tags: ["terminal"], body: { name: "CreateSessionBody", schema: createSessionBody }, reply: { name: "TerminalSession", schema: terminalSessionDto }, status: [201], errors: [400, 403, 503] },
  { method: "post", path: "/api/terminal/ensure", operationId: "ensureTerminalSession", summary: "Find or start the project's agent session", tags: ["terminal"], body: { name: "EnsureSessionBody", schema: ensureSessionBody }, reply: { name: "EnsureSession", schema: ensureSessionDto }, status: [200, 201], errors: [400, 403, 503] },
  { method: "post", path: "/api/terminal/sessions/:id/drops", operationId: "dropTerminalFiles", summary: "Drop files into one session", tags: ["terminal"], body: { form: DROP_FIELD }, reply: { name: "TerminalDrop", schema: terminalDropDto }, status: [201], errors: [400, 403, 404, 413] },
  { method: "delete", path: "/api/terminal/sessions/:id", operationId: "closeTerminalSession", summary: "Close one terminal session", tags: ["terminal"], reply: { name: "Ok", schema: okDto }, errors: [403, 404] },
  { method: "post", path: "/api/terminal/tickets", operationId: "createTerminalTicket", summary: "A single-use ticket for one session's socket", tags: ["terminal"], body: { name: "TerminalTicketBody", schema: terminalTicketBody }, reply: { name: "TerminalTicket", schema: terminalTicketDto }, errors: [400, 403, 404] },
];
