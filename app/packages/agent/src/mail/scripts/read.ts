// argv: 1 the thread's Message-ID (bare), 2 subject ("" for any), 3.. the accounts. Output: one record per draft of those
// accounts whose In-Reply-To names the thread: id FS message id FS account FS text RS. Read-only (P65 S5: what a late
// save is matched against before a write).
export const THREAD_DRAFTS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set thread to item 1 of argv
  set subj to item 2 of argv
  set accNames to {}
  repeat with i from 3 to (count of argv)
    set end of accNames to item i of argv
  end repeat
  set out to ""
  tell application "Mail"
    if subj is "" then
      set ms to (messages of drafts mailbox)
    else
      set ms to (messages of drafts mailbox whose subject is subj)
    end if
    repeat with m in ms
      if (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        if accNames contains acc and irt contains thread then set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & ((content of m) as text) & RS
      end if
    end repeat
  end tell
  return out
end run`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS Message-ID, or error FS code FS message. Read-only.
export const MESSAGE_ID_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set boxPath to my parts(item 2 of argv, LS)
  tell application "Mail"
    try
      set box to account (item 1 of argv)
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      return "ok" & FS & (message id of (first message of box whose id is ((item 3 of argv) as integer)))
    on error
      return "error" & FS & "no_message" & FS & "No message " & (item 3 of argv) & " in that mailbox of " & (item 1 of argv) & "."
    end try
  end tell
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 Message-ID (bare), 2.. account names. Output: ok FS account FS mailbox name FS id FS the account's own
// addresses (LS-joined: what it can send as, P58), or none. Read-only. INBOX
// first (3 s on a 43-message Gmail INBOX, measured 2026-11-19); the account's other mailboxes only when it is not there.
export const FIND_INBOUND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set mid to item 1 of argv
  -- P85: Sent is looked in too (a message on the owner's initiative answers our own sent copy); never Drafts, Trash, Spam.
  set skipNames to {"Drafts", "Trash", "Deleted Messages", "Bin", "Spam", "Junk"}
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  tell application "Mail"
    repeat with i from 2 to (count of argv)
      set accName to item i of argv
      try
        set acc to account accName
        try
          set m to (first message of mailbox "INBOX" of acc whose message id is mid)
          return "ok" & FS & accName & FS & "INBOX" & FS & (id of m) & FS & my addrs(acc)
        end try
      end try
    end repeat
    repeat with i from 2 to (count of argv)
      set accName to item i of argv
      try
        set acc to account accName
        repeat with b in (mailboxes of acc)
          set bn to name of b
          if bn is not "INBOX" and skipNames does not contain bn then
            try
              set m to (first message of b whose message id is mid)
              -- A nested mailbox (Gmail's [Gmail]/Sent Mail, [Gmail]/All Mail) is reached by its full name only (read-only check, 2026-11-20).
              set fullBn to bn
              try
                set c to container of b
                if (class of c as text) is "container" then set fullBn to (name of c) & "/" & bn
              end try
              return "ok" & FS & accName & FS & fullBn & FS & (id of m) & FS & my addrs(acc)
            end try
          end if
        end repeat
      end try
    end repeat
  end tell
  return "none"
end run

on addrs(acc)
  set LS to (ASCII character 29)
  set out to ""
  tell application "Mail"
    try
      -- Bound to a list first: looping straight over the property gives items Mail cannot coerce to text (read-only check, 2026-11-20).
      set lst to email addresses of acc
      repeat with a in lst
        set out to out & (contents of a) & LS
      end repeat
    end try
  end tell
  return out
end addrs`;

// argv: 1 account name. Output: ok FS its own addresses (LS-joined), or error FS code FS message. Read-only (P58).
export const ACCOUNT_ADDRESSES_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running."
  set out to ""
  tell application "Mail"
    try
      set lst to email addresses of account (item 1 of argv)
      repeat with a in lst
        set out to out & (contents of a) & LS
      end repeat
    on error
      return "error" & FS & "no_account" & FS & "No Mail account named " & (item 1 of argv) & "."
    end try
  end tell
  return "ok" & FS & out
end run`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS <all headers>, or error FS code FS message. Read-only.
export const READ_HEADERS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running."
  set boxPath to my parts(item 2 of argv, LS)
  tell application "Mail"
    try
      set box to account (item 1 of argv)
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      set m to (first message of box whose id is ((item 3 of argv) as integer))
      return "ok" & FS & ((all headers of m) as text)
    on error
      return "error" & FS & "no_message" & FS & "No message " & (item 3 of argv) & " in that mailbox."
    end try
  end tell
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS <content>, or error FS code FS message. Read-only.
export const READ_CONTENT_SCRIPT = READ_HEADERS_SCRIPT.replace("((all headers of m) as text)", "((content of m) as text)");
