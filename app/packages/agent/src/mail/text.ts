// The sentences a draft write answers with when a draft is already sent or finished (agent and person).

/**
 * P83 verdict 2: a sent draft is not revised (the agent's draft_write, the admin's Save and Restore). P85: a new message
 * to the same client, on the owner's words, is a new reply to the newest message of the thread (our sent copy, or the
 * client's newer one), with `owner_request`: its own draft, told apart from the sent one by Sent detection.
 */
export const alreadySentText = (id: number, sentAt: string | null, reader: "agent" | "person" = "agent"): string =>
  reader === "person"
    ? `Draft ${id} was sent${sentAt ? ` (${sentAt.slice(0, 16).replace("T", " ")})` : ""}: a sent mail is not revised. To write to this client again, ask the agent in the dock: it drafts a new message in the same thread, for you to review and send. Nothing was written.`
    : `Draft ${id} was sent${sentAt ? ` (${sentAt.slice(0, 16).replace("T", " ")})` : ""}: a sent mail is not revised. A new message to this client, when the owner asked for one: draft_write kind reply to the newest message of the thread (our sent copy, in Sent, or the client's newer message), with owner_request = his words from this session and its record; it gets its own draft. Nothing was written.`;

/** P99 S0 (a): a done or skipped draft is not revised in place; a new message on the owner's words is its own draft. */
export const draftFinishedText = (id: number, status: "done" | "skipped"): string =>
  `Draft ${id} is ${status}: a finished draft is not revised and is not reopened. A new message to this client, when the owner asked for one: draft_write kind reply to the newest message of the thread (ours in Sent, or the client's), with owner_request = his words from this session and its record; it gets its own draft. Nothing was written.`;
