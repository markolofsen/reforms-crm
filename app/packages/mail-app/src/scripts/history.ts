// P99 S1: the two scripts of one person's history (`../history.ts`): their messages by sender, ours in Sent by subject. Read only.

const STAMP = `set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)`;
const HEADERS = `set irt to ""
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
      end try`;

/** argv: 1 account, 2 mailbox, 3 the address. One record per message from that sender: Mail's id, Message-ID, In-Reply-To, References, sender, received "y,m,d,seconds", subject. */
export const FROM_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set out to ""
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      get name of box
    on error
      return "nobox"
    end try
    repeat with m in (messages of box whose sender contains (item 3 of argv))
      ${HEADERS}
      set d to date received of m
      ${STAMP}
      set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & RS
    end repeat
  end tell
  return "ok" & RS & out
end run`;

/**
 * argv: 1 account, 2 Sent mailbox (a Gmail account's is `[Gmail]/<name>`), 3 the address, 4 the thread subjects joined by LS. One
 * record per message of ours to that address (To or Cc) whose subject contains one of them; the same fields, the sent date.
 */
export const SENT_TO_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set addr to item 3 of argv
  set out to ""
  tell application "Mail"
    set boxPath to (item 2 of argv)
    try
      set box to mailbox boxPath of account (item 1 of argv)
      get name of box
    on error
      try
        set boxPath to "[Gmail]/" & (item 2 of argv)
        set box to mailbox boxPath of account (item 1 of argv)
        get name of box
      on error
        return "nobox"
      end try
    end try
    set AppleScript's text item delimiters to LS
    set subs to text items of (item 4 of argv)
    set AppleScript's text item delimiters to ""
    repeat with s in subs
      if (length of s) > 0 then
        repeat with m in (messages of box whose subject contains s)
          set hit to false
          try
            repeat with r in ((to recipients of m) & (cc recipients of m))
              if (address of r) is addr then set hit to true
            end repeat
          end try
          if hit then
            ${HEADERS}
            set d to date sent of m
            ${STAMP}
            set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & RS
          end if
        end repeat
      end if
    end repeat
  end tell
  return "ok" & FS & boxPath & RS & out
end run`;
