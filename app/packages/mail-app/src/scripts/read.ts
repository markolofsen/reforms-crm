// The read-only AppleScript of the Hub's Mail reads (decision 0026; P126 M1): is Mail running, a Sent mailbox since a date,
// Mail's accounts, an inbound mailbox since a date and one message's text. None of them launches, writes, moves or sends.

/** Never launches Mail: `application "Mail" is running` only looks at the process list. */
export const RUNNING_SCRIPT = `on run argv
  return (application "Mail" is running) as text
end run`;

/**
 * argv: 1 account, 2 mailbox, 3-5 year month day, 6 seconds after local midnight (the oldest date to read).
 * One record per message: Message-ID, In-Reply-To, the sent date as local "y,m,d,seconds", To, Cc, subject, References (P90:
 * a reply further down the thread) and the sender (P90: who replied, when it is not the Hub); never the text (P65). A Gmail
 * account's Sent is `[Gmail]/<name>`.
 */
export const SENT_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set fromDate to current date
  set day of fromDate to 1
  set year of fromDate to (item 3 of argv) as integer
  set month of fromDate to (item 4 of argv) as integer
  set day of fromDate to (item 5 of argv) as integer
  set time of fromDate to (item 6 of argv) as integer
  set out to ""
  tell application "Mail"
    set acc to account (item 1 of argv)
    try
      set box to mailbox (item 2 of argv) of acc
      get name of box
    on error
      set box to mailbox ("[Gmail]/" & (item 2 of argv)) of acc
    end try
    set ms to (messages of box whose date sent is greater than or equal to fromDate)
    repeat with m in ms
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set refs to ""
      try
        set refs to content of (first header of m whose name is "References")
      end try
      set snd to ""
      try
        set snd to sender of m
      end try
      set tos to ""
      set ccs to ""
      try
        repeat with r in (to recipients of m)
          set tos to tos & (address of r) & LS
        end repeat
        repeat with r in (cc recipients of m)
          set ccs to ccs & (address of r) & LS
        end repeat
      end try
      set d to date sent of m
      set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)
      set out to out & (message id of m) & FS & irt & FS & stamp & FS & tos & FS & ccs & FS & (subject of m) & FS & refs & FS & snd & RS
    end repeat
  end tell
  return out
end run`;

/** One record per account: its name, then its addresses. */
export const ACCOUNTS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set out to ""
  tell application "Mail"
    repeat with a in accounts
      set addrs to ""
      try
        repeat with e in (email addresses of a)
          set addrs to addrs & (e as text) & LS
        end repeat
      end try
      set out to out & (name of a) & FS & addrs & RS
    end repeat
  end tell
  return out
end run`;

/**
 * P96: the inbound messages of one mailbox received since a date. argv: 1 account, 2 mailbox (a name, or a nested path such
 * as `hub/client`; a mailbox the account lacks answers `nobox`, not an error), 3-5 year month day, 6 seconds after local
 * midnight. One record per message: Mail's id, Message-ID, In-Reply-To, References, the sender, the received date as local
 * "y,m,d,seconds", subject, read status, and the bulk headers present (List-Unsubscribe, Auto-Submitted, Precedence). Never
 * the text: that is `CONTENT_SCRIPT`, for the messages judged a client's only. Read-only (0.2 s for a day of one INBOX, 2026-11-21).
 */
export const INBOUND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set fromDate to current date
  set day of fromDate to 1
  set year of fromDate to (item 3 of argv) as integer
  set month of fromDate to (item 4 of argv) as integer
  set day of fromDate to (item 5 of argv) as integer
  set time of fromDate to (item 6 of argv) as integer
  set out to ""
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      get name of box
    on error
      return "nobox"
    end try
    set ms to (messages of box whose date received is greater than or equal to fromDate)
    repeat with m in ms
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set refs to ""
      try
        set refs to content of (first header of m whose name is "References")
      end try
      set bulk to ""
      try
        set bulk to bulk & "list " & (content of (first header of m whose name is "List-Unsubscribe"))
      end try
      try
        set bulk to bulk & " auto " & (content of (first header of m whose name is "Auto-Submitted"))
      end try
      try
        set bulk to bulk & " prec " & (content of (first header of m whose name is "Precedence"))
      end try
      set pkey to ""
      try
        set pkey to content of (first header of m whose name is "X-Project-Key")
      end try
      set snd to ""
      try
        set snd to sender of m
      end try
      set d to date received of m
      set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)
      set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & FS & ((read status of m) as text) & FS & bulk & FS & pkey & RS
    end repeat
  end tell
  return "ok" & RS & out
end run`;

/** P96: the text of one message by Mail's id in a known mailbox, at most 4000 characters. argv: 1 account, 2 mailbox, 3 Mail's id. Read-only. */
export const CONTENT_SCRIPT = `on run argv
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      set m to (first message of box whose id is ((item 3 of argv) as integer))
      set c to (content of m) as text
      if (length of c) > 4000 then set c to text 1 thru 4000 of c
      return "ok" & (ASCII character 31) & c
    on error
      return "none"
    end try
  end tell
end run`;
