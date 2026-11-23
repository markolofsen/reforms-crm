import { SEPARATORS } from "../records";

// Find, list and trash of the Hub's own drafts (P126 M1, from `@hub/send`): no `send` here; the send script stays in `@hub/send`.

// The record of one message, fields separated by FS, lists by LS; a message Mail flags as deleted is skipped (a
// revision's older version on its way out, P52). Used inside a `repeat with m in ms` of each read script.
const RECORDS = `
  set out to ""
  repeat with m in ms
    if (deleted status of m) is false then
      set acc to ""
      try
        set acc to name of account of mailbox of m
      end try
      set tos to ""
      set ccs to ""
      set bccs to ""
      try
        repeat with r in (to recipients of m)
          set tos to tos & (address of r) & LS
        end repeat
        repeat with r in (cc recipients of m)
          set ccs to ccs & (address of r) & LS
        end repeat
        repeat with r in (bcc recipients of m)
          set bccs to bccs & (address of r) & LS
        end repeat
      end try
      set n to 0
      try
        set n to count of mail attachments of m
      end try
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (sender of m) & FS & tos & FS & ccs & FS & bccs & FS & (subject of m) & FS & (content of m) & FS & n & FS & irt & RS
    end if
  end repeat`;


// argv: 1 subject, 2 "trash" to read Mail's Trash instead of Drafts. Output: one record per message.
export const FIND_SCRIPT = `on run argv${SEPARATORS}
  set subj to item 1 of argv
  set box to "drafts"
  if (count of argv) > 1 then set box to item 2 of argv
  tell application "Mail"
    if box is "trash" then
      set ms to (messages of trash mailbox whose subject is subj)
    else
      set ms to (messages of drafts mailbox whose subject is subj)
    end if${RECORDS}
  end tell
  return out
end run`;

// No argv. The headers of every draft of every account, never its text (P65: 0.3 s to 1.5 s for 63 drafts, against
// 1 min 29 s for a `whose content contains` read). One record per draft: id FS message id FS account FS subject FS In-Reply-To.
export const LIST_DRAFTS_SCRIPT = `on run argv${SEPARATORS}
  set out to ""
  tell application "Mail"
    repeat with m in (messages of drafts mailbox)
      if (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (subject of m) & FS & irt & RS
      end if
    end repeat
  end tell
  return out
end run`;

// argv: pairs of (account, Message-ID). A draft is moved to Trash (Mail's delete: recoverable) only when a draft of that
// account still has exactly that Message-ID, read again here, just before the delete (P65, decision 0031). Output:
// moved (LS-joined Message-IDs) FS refused FS why (LS-joined "Message-ID: Mail's error", for a refusal Mail explained).
// v0.12.15 (2026-11-19): `repeat with m in (messages … whose message id is mid)` found every draft but `delete m` failed
// on each (a loop item is a reference into the list, not Mail's message), and the `try` hid it: every move was "refused".
// The draft is now resolved to Mail's own reference by its id (the form P56's trash used), and Mail's error is returned.
export const TRASH_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set moved to ""
  set refused to ""
  set why to ""
  tell application "Mail"
    repeat with i from 1 to (count of argv) by 2
      set accName to item i of argv
      set mid to item (i + 1) of argv
      set ok to false
      set err to ""
      try
        set found to id of (messages of drafts mailbox whose message id is mid)
      on error e
        set found to {}
        set err to e
      end try
      repeat with fid in found
        try
          set m to (first message of drafts mailbox whose id is (contents of fid))
          if (deleted status of m) is false and (name of account of mailbox of m) is accName and (message id of m) is mid then
            delete m
            set ok to true
          end if
        on error e
          set err to e
        end try
      end repeat
      if ok then
        set moved to moved & mid & LS
      else
        set refused to refused & mid & LS
        if err is not "" then set why to why & mid & ": " & err & LS
      end if
    end repeat
  end tell
  return moved & FS & refused & FS & why
end run`;
