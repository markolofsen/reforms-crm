# @hub/mail

The read-only IMAP reader behind the `MailHistory` contract. The one-mail-to-Markdown converter and its CLI that used
to live here were archived by P25 (the archived mail-to-markdown material (not part of this repo); nothing imported them).

- `src/history.ts`: the `MailHistory` contract (all mail with a client address, paged, newest first).
- `src/imap/` (import `@hub/mail/imap`): the reader behind it, read-only. See below.
- Tests: `pnpm test`. Mail is untrusted data: nothing here executes or follows its text.

## IMAP reader (`@hub/mail/imap`)
`createImapHistory({ accounts, connect, me?, allow? })` implements `MailHistory` over IMAP (`imapflow` 2.11.0, the only file that imports it is
`src/imap/imapflow.ts`; `postal-mime` is the parser). Per call: one session per account, one `OR FROM/TO/CC` search per mailbox, headers only,
deduplicated by Message-Id, filtered to the exact address, newest first; the cursor is a position in that order. `source(id)` returns the raw
message. Any unreadable account fails the call with `unavailable` (no silent hole); the error text never repeats the server's.

- **Read only by construction.** `ImapSession` has `list`, `search`, `headers`, `source`, `close` and nothing else; every mailbox is opened with
  `readOnly: true` (EXAMINE, so reading never sets `\Seen`); the imapflow logger is off. No SMTP anywhere.
- **Logins** live in `state/secrets/mail-<name>.json` (git-ignored; `HUB_CONFIG_DIR` overrides), mode 600 (a looser file is refused), read again on every connection:
  `{ "account": "Google", "host": "imap.gmail.com", "port": 993, "user": "me@example.org", "pass": "<app password>" }` or `"accessToken": "<OAuth2>"`
  instead of `pass`; optional `addresses` (own addresses, so `direction` is right), `mailboxes`, `sentMailbox`. `account` is the name a project lists
  under `mail.accounts`. Default mailboxes: all except Drafts, Trash and Junk; Gmail: All Mail only.
- **Sent detection:** `readSent(account, session, since)` and `matchSent(drafts, sent)` (pure; rules and limits in a decision or plan record kept in the owner's instance).
- **Tests** use `FakeImapServer` and `buildEml` (in memory, no network, records every call so a test can assert only reads happened) and a fake imapflow client for the adapter.
  Never run against a real mailbox. Unverified: Google Workspace may refuse app passwords or basic IMAP (then an OAuth access token is needed).
