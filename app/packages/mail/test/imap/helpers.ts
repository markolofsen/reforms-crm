import type { ImapAccount } from "../../src/imap/session.js";
import { buildEml, FakeImapServer } from "../../src/imap/fake.js";

export const ME = "me@example.test";
export const ANNA = "anna@example.test";

export const account = (over: Partial<ImapAccount> = {}): ImapAccount => ({
  name: "Google",
  host: "imap.example.test",
  port: 993,
  secure: true,
  user: ME,
  auth: { pass: "hunter2-secret-pass" },
  addresses: [ME],
  ...over,
});

/** One account with INBOX, Sent, Drafts, Trash. Dates: 2026-11-01 .. 2026-11-10. */
export function server(extra: { inbox?: string[]; sent?: string[] } = {}): FakeImapServer {
  return new FakeImapServer({
    Google: {
      INBOX: {
        messages: [
          buildEml({ from: `Anna <${ANNA}>`, to: ME, subject: "Viewing next week", messageId: "<a1@x>", date: "2026-11-01T09:00:00Z", attachment: "plan.pdf" }),
          buildEml({ from: ANNA, to: ME, cc: "bob@example.test", subject: "Re: Offer", messageId: "<a2@x>", date: "2026-11-05T09:00:00Z" }),
          buildEml({ from: "bob@example.test", to: ME, subject: "Unrelated", messageId: "<b1@x>", date: "2026-11-06T09:00:00Z" }),
          // a different address that contains Anna's as a substring: the server matches it, the reader must not
          buildEml({ from: "joanna@example.test", to: ME, subject: "Not Anna", messageId: "<j1@x>", date: "2026-11-07T09:00:00Z" }),
          ...(extra.inbox ?? []),
        ],
      },
      Sent: {
        specialUse: "\\Sent",
        messages: [
          buildEml({ from: ME, to: ANNA, subject: "Re: Viewing next week", messageId: "<s1@x>", date: "2026-11-02T09:00:00Z", inReplyTo: "<a1@x>", references: ["<a1@x>"] }),
          buildEml({ from: ME, to: `Anna <${ANNA}>`, subject: "Offer", messageId: "<s2@x>", date: "2026-11-04T09:00:00Z" }),
          ...(extra.sent ?? []),
        ],
      },
      Drafts: { specialUse: "\\Drafts", messages: [buildEml({ from: ME, to: ANNA, subject: "Unsent draft", messageId: "<d1@x>", date: "2026-11-09T09:00:00Z" })] },
      Trash: { specialUse: "\\Trash", messages: [buildEml({ from: ANNA, to: ME, subject: "Trashed", messageId: "<t1@x>", date: "2026-11-03T09:00:00Z" })] },
    },
  });
}
