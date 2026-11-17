import { composeHref, copyText, openExternal } from "./external";

/**
 * Reply all + copy: the text goes to the clipboard and a compose window opens, addressed and titled. Nothing is
 * sent; the person presses Send in Mail. (Decision, owner 2026-11-14: `mailto:` plus clipboard for now.)
 * Returns whether the clipboard took the text.
 */
export async function openReplyAll(d: { toAddr: string; ccAddr: string | null; subject: string; body: string }): Promise<boolean> {
  const copied = await copyText(d.body); // blocked: the compose window still opens
  openExternal(composeHref(d));
  return copied;
}

/**
 * `message://` link that opens one message in Mail, from a Message-ID (`<id@host>` or `id@host`). Null for any other
 * reference (for instance the id of a draft made in Mail), where there is no link to build.
 */
export function mailLink(mailRef: string | null): string | null {
  const id = mailRef?.trim().match(/^<?([^<>\s]+@[^<>\s]+)>?$/)?.[1];
  return id ? `message://${encodeURIComponent(`<${id}>`)}` : null;
}
