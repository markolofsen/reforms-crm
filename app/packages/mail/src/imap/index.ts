// IMAP side of @hub/mail (import from "@hub/mail/imap"). Read-only: no session method writes, and nothing sends.
export { createImapHistory, type ImapHistoryOptions } from "./history";
export { countNewSince, windowStart, NEW_WINDOW_DAYS, type CountNewOptions, type CountNewResult } from "./count-new";
export { findSentMailbox, matchSent, normSubject, readSent, type DraftToMatch, type SentMatch, type SentMessage, type SentVia } from "./sent";
export { CREDS_FILE, secretsDir, loadAccounts, parseAccount, redactSecrets, type LoadResult } from "./creds";
export { imapflowConnect, sessionOver, type ImapFlowLike } from "./imapflow";
export { FakeImapServer, buildEml, type FakeMessage, type FakeMailbox } from "./fake";
export type { ImapAccount, ImapConnect, ImapQuery, ImapSession, MailboxInfo, RawHeader } from "./session";
