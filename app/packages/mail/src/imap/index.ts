// IMAP side of @hub/mail (import from "@hub/mail/imap"). Read-only: no session method writes, and nothing sends.
export { createImapHistory, type ImapHistoryOptions } from "./history.js";
export { countNewSince, windowStart, NEW_WINDOW_DAYS, type CountNewOptions, type CountNewResult } from "./count-new.js";
export { findSentMailbox, matchSent, normSubject, readSent, type DraftToMatch, type SentMatch, type SentMessage, type SentVia } from "./sent.js";
export { CREDS_FILE, secretsDir, loadAccounts, parseAccount, redactSecrets, type LoadResult } from "./creds.js";
export { imapflowConnect, sessionOver, type ImapFlowLike } from "./imapflow.js";
export { FakeImapServer, buildEml, type FakeMessage, type FakeMailbox } from "./fake.js";
export type { ImapAccount, ImapConnect, ImapQuery, ImapSession, MailboxInfo, RawHeader } from "./session.js";
