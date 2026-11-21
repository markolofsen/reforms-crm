import type { MessengerChannel } from "@hub/db";
import type { DirectoryEntry, UserDialog } from "@hub/messengers";
import type { UserDialogDto } from "@hub/contract/messengers";

/**
 * P102: the dialogs of one account for the Link a chat box, marked against the client record the owner picked (never against a
 * Hub `clients` row: a record exists in Notion before it has one). `suggested`: the dialog's Telegram username or phone is one of
 * the record's identifiers; `linked`: the chat is already on the project's allow-list. Pure; the dialogs are read on demand and
 * never stored.
 */
export function markDialogs(channel: MessengerChannel, record: Pick<DirectoryEntry, "identifiers">, dialogs: readonly UserDialog[], allowed: ReadonlySet<string>): UserDialogDto[] {
  const digits = (p: string | null) => (p ?? "").replace(/\D/g, "");
  const marked = dialogs.map((d) => {
    // A WhatsApp chat id is the number itself; a Telegram chat id never is.
    const phone = digits(d.phone ?? (channel === "whatsapp" ? d.chatId : null));
    const username = (d.username ?? "").replace(/^@/, "").toLowerCase();
    const suggested = record.identifiers.some((i) => (i.kind === "username" ? username !== "" && i.value === username : phone !== "" && digits(i.value) === phone));
    return { chatId: d.chatId, title: d.title, username: d.username, phone: d.phone, suggested, linked: allowed.has(d.chatId) };
  });
  return [...marked.filter((d) => d.suggested), ...marked.filter((d) => !d.suggested)];
}
