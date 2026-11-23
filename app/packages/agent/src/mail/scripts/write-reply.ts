// argv: 1 account, 2 mailbox path (LS-joined), 3 message id, 4 body, 5 sender or "", 6 "keep" to write the body verbatim
// (no quote added; P56), 7 the probe (the body's first 40 characters), 8 the versions to replace (LS-joined, each
// "account PS Message-ID"), 9 the accounts Mail may save the draft in (LS-joined: the project's; Mail saves a draft in its
// From's account, P65 S5), 10 how many seconds to wait for the saved draft. Output: ok FS draftId FS subject FS thread FS
// from FS replaced (LS) FS left (LS) FS new message id FS its account FS cleared Mail ids (LS) FS Mail's reply shell FS
// the text read back; or pending FS Mail's reply shell (the draft was not seen in time: it may still land); or error FS
// code FS message. A message Mail flags as deleted (pending expunge) is not a draft.
export const WRITE_REPLY_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set PS to (ASCII character 28)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set accName to item 1 of argv
  set boxPath to my parts(item 2 of argv, LS)
  set srcId to (item 3 of argv) as integer
  set theBody to item 4 of argv
  set wantSender to item 5 of argv
  set addQuote to (item 6 of argv) is not "keep"
  set probe to item 7 of argv
  set targets to my parts(item 8 of argv, LS)
  set landIn to my parts(item 9 of argv, LS)
  if (count of landIn) is 0 then set landIn to {accName}
  set waitSecs to (item 10 of argv) as integer
  tell application "Mail"
    try
      set acc to account accName
      set accAddrs to email addresses of acc
    on error
      return "error" & FS & "no_account" & FS & "No Mail account named " & accName & "."
    end try
    try
      set box to acc
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      set src to (first message of box whose id is srcId)
    on error
      return "error" & FS & "no_message" & FS & "No message " & srcId & " in that mailbox of " & accName & "."
    end try
    set thread to message id of src
    set origText to ""
    try
      set origText to (content of src) as text
    end try
    set tail to ""
    if addQuote then set tail to linefeed & linefeed & "On " & ((date sent of src) as string) & ", " & (sender of src) & " wrote:" & linefeed & my quoteOf(origText)
    -- P85: is the answered message our own (its sender one of this account's addresses)? Then its recipients, read now,
    -- before any reply exists, are who the reply goes to.
    set srcFrom to ""
    try
      set srcFrom to (sender of src) as text
    end try
    set ownMsg to false
    repeat with a in accAddrs
      if srcFrom contains (contents of a) then set ownMsg to true
    end repeat
    set toList to {}
    set ccList to {}
    if ownMsg then
      set srcTo to address of every to recipient of src
      set srcCc to address of every cc recipient of src
      set toList to my othersOf(srcTo, accAddrs)
      set ccList to my othersOf(srcCc, accAddrs)
      if (count of toList) is 0 then return "error" & FS & "no_recipient" & FS & "The message answered is our own and names no recipient outside this account: there is nobody to write to. Nothing was written."
    end if
    -- Every draft that exists before the reply: whatever appears after it is this write's (one bulk read).
    set priorIds to id of every message of drafts mailbox
    set r to reply src opening window false
    set subj to subject of r
    -- Never read the reply's content before it is set (P83): on Mail 16 that read returns "" and Mail then ignores every
    -- set of it, so each write ended in content_refused (measured 2026-11-20). Mail's shell is recognised by its form instead.
    set shellText to ""
    set fromNow to sender of r
    set inAccount to false
    repeat with a in accAddrs
      if fromNow contains (contents of a) then set inAccount to true
    end repeat
    if wantSender is not "" then
      -- P58: the From the Hub chose (TS decides it). Mail's own pick is kept when it already is that address (its display name stays).
      if fromNow does not contain wantSender then set sender of r to wantSender
    else if not inAccount then
      set fullName to ""
      try
        set fullName to full name of acc
      end try
      if fullName is "" or fullName is missing value then
        set sender of r to (item 1 of accAddrs)
      else
        set sender of r to fullName & " <" & (item 1 of accAddrs) & ">"
      end if
    end if
    -- P85: a reply to our own message (the owner writes again before the client answered) goes to that message's own
    -- recipients, minus our addresses, as the Hub's door sets them (Mail's own pick for a reply to us is not measured).
    -- Set before the text, as the door does.
    if ownMsg then
      delete every to recipient of r
      delete every cc recipient of r
      tell r
        repeat with x in toList
          make new to recipient at end of to recipients with properties {address:(contents of x)}
        end repeat
        repeat with x in ccList
          make new cc recipient at end of cc recipients with properties {address:(contents of x)}
        end repeat
      end tell
    end if
    set content of r to (theBody & tail)
    delay 0.3
    if ((content of r) as text) does not contain probe then
      delete r
      -- Mail keeps a refused reply in Drafts (P83, 2026-11-20): this run's own, recognised by its form, goes to Trash.
      set cleared to ""
      set deadline to (current date) + 6
      repeat
        repeat with fid in my threadDrafts(subj, landIn, thread, priorIds)
          try
            set m to (first message of drafts mailbox whose id is (contents of fid))
            if (deleted status of m) is false and my isShell((content of m) as text, origText) then
              delete m
              set cleared to cleared & (contents of fid) & LS
            end if
          end try
        end repeat
        if cleared is not "" or (current date) > deadline then exit repeat
        delay 0.5
      end repeat
      return "error" & FS & "content_refused" & FS & "Mail did not take the text of the reply. This is the Hub's Mail writer, not a macOS permission (a missing permission is mail_not_allowed). Nothing was saved or replaced." & FS & cleared
    end if
    save r
    delay 0.5
    set fromNow to sender of r
    delete r
    -- Wait for the saved draft: a new draft of this thread, in any account Mail may have saved it in, holding the text's start.
    set mine to {}
    set shells to {}
    set deadline to (current date) + waitSecs
    repeat
      set mine to {}
      set shells to {}
      repeat with fid in my threadDrafts(subj, landIn, thread, priorIds)
        set t to ""
        try
          set t to (content of (first message of drafts mailbox whose id is (contents of fid))) as text
        end try
        considering case
          if t contains probe then
            set end of mine to (contents of fid)
          else if my isShell(t, origText) then
            set end of shells to (contents of fid)
          end if
        end considering
      end repeat
      if (count of mine) > 0 or (current date) > deadline then exit repeat
      delay 0.5
    end repeat
    if (count of mine) is 0 then return "pending" & FS & shellText
    set newId to item 1 of mine
    repeat with x in mine
      if (contents of x) > newId then set newId to (contents of x)
    end repeat
    set nm to (first message of drafts mailbox whose id is newId)
    set newMid to message id of nm
    set newAcc to name of account of mailbox of nm
    set readBack to (content of nm) as text
    -- This run's own extras: a second save of the same text, and Mail's empty reply shell.
    set cleared to ""
    repeat with x in (mine & shells)
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
      -- Resolved to Mail's own reference by id before the delete: a \`repeat with m in (messages …)\` item is not one (v0.12.15).
      try
        -- Bound to a list first: looping straight over the ids expression gives a specifier Mail cannot iterate (read-only check, 2026-11-19).
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
  return "ok" & FS & newId & FS & subj & FS & thread & FS & fromNow & FS & replaced & FS & leftIds & FS & newMid & FS & newAcc & FS & cleared & FS & shellText & FS & readBack
end run

on threadDrafts(subj, accNames, thread, skipIds)
  set out to {}
  tell application "Mail"
    repeat with m in (messages of drafts mailbox whose subject is subj)
      set mid to id of m
      if skipIds does not contain mid and out does not contain mid and (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        if accNames contains acc and irt contains thread then set end of out to mid
      end if
    end repeat
  end tell
  return out
end threadDrafts

-- The addresses of a recipient list that are not one of ours (lowercase compare).
on othersOf(addrList, own)
  set out to {}
  repeat with x in addrList
    set ax to (contents of x) as text
    set mine to false
    repeat with o in own
      ignoring case
        if ax is ((contents of o) as text) then set mine to true
      end ignoring
    end repeat
    if not mine and out does not contain ax then set end of out to ax
  end repeat
  return out
end othersOf

on quoteOf(t)
  set out to ""
  set n to 0
  repeat with p in paragraphs of t
    set n to n + 1
    if n > 80 then exit repeat
    set out to out & "> " & (contents of p) & linefeed
  end repeat
  return out
end quoteOf

-- Mail's own reply shell (P83; the form @hub/db isReplyShell matches): no text at all, or one attribution line ending
-- in ":" over the quoted original and nothing else. Whitespace and quote marks are ignored on both sides.
on isShell(t, orig)
  set flatT to my squeeze(t)
  if flatT is "" then return true
  set flatO to my squeeze(orig)
  if flatO is "" then return false
  set hd to ""
  repeat with p in paragraphs of t
    if my squeeze(contents of p) is not "" then
      set hd to my squeeze(contents of p)
      exit repeat
    end if
  end repeat
  if (length of hd) > 300 or hd does not end with ":" then return false
  considering case
    return flatT is (hd & flatO)
  end considering
end isShell

on squeeze(s)
  set AppleScript's text item delimiters to {space, tab, linefeed, return, ">", character id 160}
  set xs to text items of s
  set AppleScript's text item delimiters to ""
  set out to xs as text
  return out
end squeeze

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;
