# @hub/mail-app

Apple Mail through `osascript` (P126 M1, decision 0026: Apple Mail only, no key, no IMAP).

- `osa`: the one runner (`osaWithin`, `osaFor(job)`), the budget of each job (`MAIL_BUDGETS`: read, long, write), `MailNotAnswering`, `isNotAllowed`.
- `records`: the separators (FS, RS, LS, PS), `records`, `bareId`, `rawId`, `localStamp`.
- `read`, `history`: the read-only questions (running, Sent, accounts, inbound, one text, a person's history).
- `drafts`: the Hub's own drafts in Mail: find, list, trash.
- `scripts/*`: the AppleScript, one file per job.

No script here contains the AppleScript `send` verb (`test/no-send.test.ts`); the one send script is `@hub/send`'s `SEND_SCRIPT`.

Update this page when the architecture changes.
