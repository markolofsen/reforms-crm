// `@hub/agent/mail` (P129 A1): the Mail.app draft writer behind `draft_write` and the admin's Save and Restore (P52, P56,
// decision 0030): its types, the real writer over osascript, the one revision path, the recorded write and its texts.
// The fake is `@hub/agent/mail/fake`; the scripts and their parsers stay inside the package.
export { DraftWriteError, type DraftWriter, type InboundMessage, type NewDraftInput, type ReplyDraftInput, type ReplyDraftResult, type Revision, type Signed, type ThreadMailDraft, type VersionRef, type WriteLog } from "./types";
export { defaultOsa, isNotAllowed, mailAppDraftWriter, OsaTimeout, osaWithin, WRITE_WAIT_SECONDS, type OsaRun } from "./writer";
export { fromFor, isNewThreadDraft, lateSaves, reviseDraft, writeRecorded, type ReviseInput } from "./revise";
export { alreadySentText, draftFinishedText, MAIL_SLOW_TEXT, probeOf, versionHash, writtenBody } from "./text";
export { recordAdoptions, writeLogOf, type AdoptedVersion, type WithRepos } from "./write-log";
