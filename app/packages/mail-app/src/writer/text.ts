import { withoutLeadingBlankLines } from "@hub/db";

/** P94: the text the writer hands Mail: no blank lines above it (Mail's reply adds its own empty top line) and none below. */
export const writtenBody = (body: string): string => withoutLeadingBlankLines(body.trimEnd());

/** What the script checks Mail took: the body's first 40 characters (Mail may rewrap or add an HTML part, never drop the start). */
export const probeOf = (body: string): string => body.replace(/^\s+/, "").slice(0, 40);

/**
 * What the agent (and a person's Save) is told when Mail is slow (P65 S5). It never asks anyone to delete a draft and
 * never says "write again": a second write while the first is still landing is what made two drafts on 2026-11-19.
 */
export const MAIL_SLOW_TEXT = "Mail is slow: it has not shown the saved draft yet. The write may still land in Drafts; the Hub recorded it and adopts it as this draft's version when it appears (at the next write, the card's next read, or hub drafts sweep). Nothing older was replaced. Do not call draft_write again for this draft now: tell the owner in one line that Mail is slow and the new text will show on the card when Mail saves it.";
