import { z } from "zod";
import { messengerSendBody, messengerSendPreviewDto } from "@hub/contract/messenger";
import { batchSendBody, batchSendParam, batchTicketBody, idParam, projectQuery, sendBody, sendParam, sendTicketBody, slugParam } from "@hub/contract/requests";
import { batchRunStateDto, batchSendPlanDto, sendCancelledDto, sendPreviewDto, sendsDto, sendTicketDto, sentDto, stopDto } from "@hub/contract/sending";
import type { Operation } from "../http/openapi";

const ticket = { name: "SendTicket", schema: sendTicketDto };
const run = { name: "BatchRunState", schema: batchRunStateDto };
const stop = { name: "Stop", schema: stopDto };

/**
 * The send doors (decision 0011, P120 W2): the one confirmed route per channel, its single-use ticket, the batch run and the
 * project's stop. `apply: false` answers the preview, `apply: true` with the ticket and the person's confirmation sends; the
 * generated operation only carries the call, the facade (`lib/api/send.ts`, `lib/api/messengers/send.ts`) owns the door.
 * Not declared: the agent's messenger send (decision 0046), which `hub mcp` calls, never the browser.
 */
export const operations: Operation[] = [
  { method: "post", path: "/api/sends/tickets", operationId: "createSendTicket", summary: "A single-use ticket for one send", tags: ["sending"], body: { name: "SendTicketBody", schema: sendTicketBody }, reply: ticket, errors: [400, 403, 404, 409] },
  { method: "post", path: "/api/sends/batch-tickets", operationId: "createBatchSendTicket", summary: "A single-use ticket for one batch run", tags: ["sending"], body: { name: "BatchTicketBody", schema: batchTicketBody }, reply: ticket, errors: [400, 403, 404, 409] },
  { method: "post", path: "/api/projects/:slug/drafts/:id/send", operationId: "sendMailDraft", summary: "Preview or send one Mail draft (the owner's confirmed click)", tags: ["sending"], params: sendParam, body: { name: "SendBody", schema: sendBody }, reply: { name: "MailSendOutcome", schema: z.union([sendPreviewDto, sentDto]) }, errors: [400, 403, 404, 409, 500] },
  { method: "post", path: "/api/projects/:slug/messengers/drafts/:id/send", operationId: "sendMessengerDraft", summary: "Preview or send one messenger draft (the owner's confirmed click)", tags: ["sending"], params: sendParam, body: { name: "MessengerSendBody", schema: messengerSendBody }, reply: { name: "MessengerSendOutcome", schema: z.union([messengerSendPreviewDto, sentDto]) }, errors: [400, 403, 404, 409, 500] },
  { method: "get", path: "/api/projects/:slug/batches/:id/send", operationId: "getBatchSend", summary: "Read one batch run", tags: ["sending"], params: batchSendParam, reply: run, errors: [404] },
  { method: "post", path: "/api/projects/:slug/batches/:id/send", operationId: "runBatchSend", summary: "Plan or start one batch run (the owner's confirmed click)", tags: ["sending"], params: batchSendParam, body: { name: "BatchSendBody", schema: batchSendBody }, reply: { name: "BatchSendOutcome", schema: z.union([batchSendPlanDto, batchRunStateDto]) }, errors: [400, 403, 404, 409] },
  { method: "post", path: "/api/projects/:slug/batches/:id/send/stop", operationId: "stopBatchSend", summary: "Stop one batch run", tags: ["sending"], params: batchSendParam, reply: run, errors: [403, 404] },
  { method: "get", path: "/api/projects/:slug/sends", operationId: "listSends", summary: "List the project's sends", tags: ["sending"], params: slugParam, reply: { name: "Sends", schema: sendsDto }, errors: [404, 503] },
  { method: "post", path: "/api/sends/:id/cancel", operationId: "cancelSend", summary: "Cancel one queued send", tags: ["sending"], params: idParam, query: projectQuery, reply: { name: "SendCancelled", schema: sendCancelledDto }, errors: [400, 403, 404, 409] },
  { method: "post", path: "/api/projects/:slug/sends/stop", operationId: "stopSends", summary: "Stop the project's sending", tags: ["sending"], params: slugParam, reply: stop, errors: [403, 404] },
  { method: "post", path: "/api/projects/:slug/sends/resume", operationId: "resumeSends", summary: "Resume the project's sending", tags: ["sending"], params: slugParam, reply: stop, errors: [403, 404] },
];
