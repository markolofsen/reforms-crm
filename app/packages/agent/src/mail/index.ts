// `@hub/agent/mail` (P129 A1, P126 M2): the draft use case around the Mail writer behind `draft_write` and the admin's Save
// and Restore (P52, P56, decision 0030): the one revision path, the recorded write and its texts. The writer itself, its
// scripts, parsers and fake are `@hub/mail-app/writer*`.
export type { Revision, Signed, WriteLog } from "./types";
export { fromFor, isNewThreadDraft, lateSaves, reviseDraft, writeRecorded, type ReviseInput } from "./revise";
export { alreadySentText, draftFinishedText } from "./text";
export { recordAdoptions, writeLogOf, type AdoptedVersion, type WithRepos } from "./write-log";
