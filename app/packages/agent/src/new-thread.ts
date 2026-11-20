// A brand-new thread (P85b, decision 0030 addendum of 2026-11-20 "a new thread"): an unsent outgoing message saved in Mail's
// Drafts, for a client the project has never written to and who never wrote (no thread exists, so there is nothing to reply
// to). Written on the owner's words only (`owner_request`), from the project's own address to the client's address, through
// Mail's own scripting with no window, no focus and no clipboard, like the reply writer. It never leaves Mail: the script has
// no instruction that would put it on the wire. It is reviewed, Checked and sent like any other draft; the hub's send door then
// sends it as a new message (it answers nothing).
//
// Identity: such a draft answers no message, so its `mailRef` stays null (decision 0031 point 2). Its Mail versions and write
// records are keyed by `newThreadKey(<client address>)`: one open new-thread draft per client, found again by a rerun.

export { isNewThreadKey, newThreadKey } from "@hub/config";

/** What the new-thread writer needs: the account to write from, its From, the client, the subject and the plain text. */
export interface NewDraftInput {
  /** One of the project's Mail accounts (as Mail names it): its addresses decide the From when `sender` is empty. */
  account: string;
  /** The From: the project's sender or brand address; "" or null: the account's first address with its full name. */
  sender: string | null;
  /** The client's address (one); never one of ours. */
  to: string;
  subject: string;
  body: string;
  /** The Hub's older versions of this new thread (from `mail_versions`): moved to Trash after the save. */
  replace?: readonly { account: string; messageId: string }[];
  /** The accounts Mail may save the draft in (the project's `mail.accounts`). */
  landIn?: readonly string[];
  waitSeconds?: number;
}

// argv: 1 account, 2 From or "", 3 the client's address, 4 subject, 5 body, 6 probe (the body's first 40 characters), 7 the
// versions to replace (LS-joined "account PS Message-ID"), 8 the accounts Mail may save the draft in (LS-joined), 9 seconds to
// wait for the saved draft. Output as WRITE_REPLY_SCRIPT's (the thread field empty, no shell): ok FS draftId FS subject FS "" FS
// from FS replaced FS left FS new Message-ID FS its account FS cleared FS "" FS the text read back; or pending FS ""; or error FS
// code FS message. Never the word for putting a message on the wire, by design: it only saves.
export const WRITE_NEW_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set PS to (ASCII character 28)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set accName to item 1 of argv
  set wantFrom to item 2 of argv
  set toAddr to item 3 of argv
  set subj to item 4 of argv
  set theBody to item 5 of argv
  set probe to item 6 of argv
  set targets to my parts(item 7 of argv, LS)
  set landIn to my parts(item 8 of argv, LS)
  if (count of landIn) is 0 then set landIn to {accName}
  set waitSecs to (item 9 of argv) as integer
  tell application "Mail"
    try
      set acc to account accName
      set accAddrs to email addresses of acc
    on error
      return "error" & FS & "no_account" & FS & "No Mail account named " & accName & "."
    end try
    if wantFrom is "" then
      set fullName to ""
      try
        set fullName to full name of acc
      end try
      if fullName is "" or fullName is missing value then
        set wantFrom to (item 1 of accAddrs)
      else
        set wantFrom to fullName & " <" & (item 1 of accAddrs) & ">"
      end if
    end if
    -- Every draft that exists before this one: whatever appears after it, with this subject and text, is this write's.
    set priorIds to id of every message of drafts mailbox
    set r to make new outgoing message with properties {subject:subj, visible:false}
    set sender of r to wantFrom
    tell r
      make new to recipient at end of to recipients with properties {address:toAddr}
    end tell
    set content of r to theBody
    delay 0.3
    if ((content of r) as text) does not contain probe then
      delete r
      return "error" & FS & "content_refused" & FS & "Mail did not take the text of the new message. Nothing was saved or replaced." & FS & ""
    end if
    save r
    delay 0.5
    set fromNow to sender of r
    delete r
    set mine to {}
    set deadline to (current date) + waitSecs
    repeat
      set mine to {}
      repeat with m in (messages of drafts mailbox whose subject is subj)
        set mid to id of m
        if priorIds does not contain mid and (deleted status of m) is false then
          set acc2 to ""
          try
            set acc2 to name of account of mailbox of m
          end try
          set t to ""
          try
            set t to (content of m) as text
          end try
          considering case
            if landIn contains acc2 and t contains probe then set end of mine to mid
          end considering
        end if
      end repeat
      if (count of mine) > 0 or (current date) > deadline then exit repeat
      delay 0.5
    end repeat
    if (count of mine) is 0 then return "pending" & FS & ""
    set newId to item 1 of mine
    repeat with x in mine
      if (contents of x) > newId then set newId to (contents of x)
    end repeat
    set nm to (first message of drafts mailbox whose id is newId)
    set newMid to message id of nm
    set newAcc to name of account of mailbox of nm
    set readBack to (content of nm) as text
    -- This run's own extra: a second save of the same text.
    set cleared to ""
    repeat with x in mine
      set xid to contents of x
      if xid is not newId then
        try
          set m to (first message of drafts mailbox whose id is xid)
          if (deleted status of m) is false then
            delete m
            set cleared to cleared & xid & LS
          end if
        end try
      end if
    end repeat
    set replaced to ""
    set leftIds to ""
    repeat with t in targets
      set pair to my parts(contents of t, PS)
      set tAcc to item 1 of pair
      set tid to item 2 of pair
      try
        set found to id of (messages of drafts mailbox whose message id is tid)
        repeat with fid in found
          set m to (first message of drafts mailbox whose id is (contents of fid))
          if (id of m) is not newId and (deleted status of m) is false and (name of account of mailbox of m) is tAcc and (message id of m) is tid then
            delete m
            set replaced to replaced & tid & LS
          end if
        end repeat
      on error
        set leftIds to leftIds & tid & LS
      end try
    end repeat
  end tell
  return "ok" & FS & newId & FS & subj & FS & "" & FS & fromNow & FS & replaced & FS & leftIds & FS & newMid & FS & newAcc & FS & cleared & FS & "" & FS & readBack
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

/** A hub draft that is a new thread (P85b): it answers no message and its recorded context says so (`newThread`). */
export const isNewThreadDraft = (d: { mailRef: string | null; context: string | null }): boolean => {
  if (d.mailRef) return false;
  try {
    const c = JSON.parse(d.context ?? "null") as { newThread?: unknown } | null;
    return c !== null && typeof c === "object" && c.newThread === true;
  } catch {
    return false;
  }
};
