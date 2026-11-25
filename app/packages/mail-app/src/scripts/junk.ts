// P147 3m item 1: one inbound message to its account's Junk (recoverable, like Trash). argv: 1 the account's name, 2 the mailbox
// the reader found it in, 3 its bare Message-ID. Found in that mailbox (else INBOX), marked junk so Mail learns, and moved to the
// account's own Junk or Spam mailbox, else Mail's Junk. It touches nothing else. Answers "ok" or "missing<TAB>why".
export const JUNK_SCRIPT = `on run argv
  set accName to item 1 of argv
  set boxName to item 2 of argv
  set mid to item 3 of argv
  tell application "Mail"
    if not (exists account accName) then return "missing" & tab & "Mail has no account " & accName
    set acc to account accName
    set m to missing value
    if exists mailbox boxName of acc then
      try
        set m to (first message of mailbox boxName of acc whose message id is mid)
      end try
    end if
    if m is missing value then
      try
        set m to (first message of mailbox "INBOX" of acc whose message id is mid)
      end try
    end if
    if m is missing value then return "missing" & tab & "the message is no longer in " & boxName
    set target to missing value
    repeat with n in {"Junk", "Spam", "[Gmail]/Spam", "Junk E-mail", "Bulk Mail"}
      if exists mailbox (contents of n) of acc then
        set target to mailbox (contents of n) of acc
        exit repeat
      end if
    end repeat
    try
      set junk mail status of m to true
    end try
    if target is missing value then
      move m to junk mailbox
    else
      move m to target
    end if
    return "ok"
  end tell
end run`;
