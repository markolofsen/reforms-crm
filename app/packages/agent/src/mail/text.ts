import { createHash } from "node:crypto";
import { withoutLeadingBlankLines } from "@hub/db";

/** The fingerprint of a version's text as Mail returned it (decision 0013: the hash, never the text). */
export const versionHash = (text: string): string => createHash("sha256").update(text.replace(/\s+$/, "")).digest("hex");

/** P94: the text the writer hands Mail: no blank lines above it (Mail's reply adds its own empty top line) and none below. */
export const writtenBody = (body: string): string => withoutLeadingBlankLines(body.trimEnd());

/** What the script checks Mail took: the body's first 40 characters (Mail may rewrap or add an HTML part, never drop the start). */
export const probeOf = (body: string): string => body.replace(/^\s+/, "").slice(0, 40);

/**
 * What the agent (and a person's Save) is told when Mail is slow (P65 S5). It never asks anyone to delete a draft and
 * never says "write again": a second write while the first is still landing is what made two drafts on 2026-11-19.
 */
export const MAIL_SLOW_TEXT = "Mail is slow: it has not shown the saved draft yet. The write may still land in Drafts; the Hub recorded it and adopts it as this draft's version when it appears (at the next write, the card's next read, or hub drafts sweep). Nothing older was replaced. Do not call draft_write again for this draft now: tell the owner in one line that Mail is slow and the new text will show on the card when Mail saves it.";

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
