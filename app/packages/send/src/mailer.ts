import { execFile } from "node:child_process";

// The one door out of the hub (decision 0011). `Mailer` is the whole surface `hub send` needs from Mail: read the
// drafts that match a recorded draft, and send one of them. `MailAppMailer` does it through Mail.app's scripting
// with `osascript` run by the hub process; the agent's shell has `Bash(osascript *)` denied (P17), so it cannot reach
// this path. `FakeMailer` is what every test uses: no test touches Mail or sends anything.

/** A draft as Mail holds it. */
export interface MailDraft {
  /** Mail's own id of the draft message; the key `send` and the trash step use. */
  ref: string;
  /** The draft's Message-ID header (without angle brackets), when Mail has one. */
  messageId: string | null;
  /** Mail account name the draft sits in. */
  account: string | null;
  /** From, as Mail shows it (`Name <addr>` or `addr`). */
  sender: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text. */
  body: string;
  attachments: number;
}

export interface DraftQuery {
  mailRef: string | null;
  subject: string;
}

/** One message of a conversation as Mail holds it. Read on demand, never stored (decision 0013). */
export interface ThreadMessage {
  /** Local time of Mail's machine, `YYYY-MM-DDTHH:MM:SS` (no zone: Mail reports local time). */
  at: string;
  /** The sender as Mail shows it. */
  who: string;
  /** `in` came from the client (Inbox), `out` is ours (Sent). */
  direction: "in" | "out";
  subject: string;
  /** The first 200 characters of the plain text, whitespace folded. */
  excerpt: string;
}

export interface ThreadQuery {
  /** The Message-ID of the draft (carried for a Mailer that can read headers; the Mail script matches by subject and address). */
  mailRef: string | null;
  subject: string;
  /** The client's address: the conversation is the messages to or from it with this subject. */
  address: string;
}

export interface Mailer {
  /** Drafts whose subject equals `subject` (candidates; the caller picks by `mailRef` and recipient). Read only. */
  findDrafts(q: DraftQuery): Promise<MailDraft[]>;
  /** The last `limit` messages of the conversation, newest first. Read only; throws when Mail cannot be read. */
  thread(q: ThreadQuery, limit: number): Promise<ThreadMessage[]>;
  /** Sends exactly this draft's text to exactly its recipients. Throws when Mail refuses. */
  send(d: MailDraft): Promise<{ messageId: string | null }>;
}

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

export const defaultOsa: OsaRun = (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout),
    ),
  );

const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";

/** Message-ID with the angle brackets and spaces removed: how mailRef and Mail's `message id` are compared. */
export const bareId = (id: string | null | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

// argv: 1 subject. Output: one record per draft, fields separated by FS, lists by LS.
export const FIND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set subj to item 1 of argv
  set out to ""
  tell application "Mail"
    set ms to (messages of drafts mailbox whose subject is subj)
    repeat with m in ms
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
      set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (sender of m) & FS & tos & FS & ccs & FS & bccs & FS & (subject of m) & FS & (content of m) & FS & n & RS
    end repeat
  end tell
  return out
end run`;

export function parseFindOutput(out: string): MailDraft[] {
  const list = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  const drafts: MailDraft[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 10) continue;
    const [ref, messageId, account, sender, to, cc, bcc, subject, body, n] = p as [string, string, string, string, string, string, string, string, string, string];
    drafts.push({ ref, messageId: bareId(messageId) || null, account: account || null, sender: sender || null, to: list(to), cc: list(cc), bcc: list(bcc), subject, body, attachments: Number(n) || 0 });
  }
  return drafts;
}

/** The subject without its Re:/Fwd: prefixes: what every message of one conversation shares. */
export const threadSubject = (subject: string): string => {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fwd?|aw|wg|sv|vs|tr|rv)\s*:\s*/i, "");
    if (next === s) return s;
    s = next.trim();
  }
};

/** The most messages the script collects before TypeScript sorts them: a bound on a huge mailbox, not on what is shown. */
export const THREAD_SCAN_CAP = 60;

// argv: 1 base subject, 2 client address, 3 cap. Output: one record per message, fields separated by FS:
// direction (in|out), local time `YYYY-MM-DDTHH:MM:SS`, sender, subject, the first 600 characters of the text.
// Read only: it never makes, changes, moves or sends a message.
export const THREAD_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set base to item 1 of argv
  set addr to item 2 of argv
  set cap to (item 3 of argv) as integer
  set out to ""
  set seen to 0
  tell application "Mail"
    repeat with dir in {"in", "out"}
      if (contents of dir) is "in" then
        set ms to (messages of inbox whose subject contains base)
      else
        set ms to (messages of sent mailbox whose subject contains base)
      end if
      repeat with m in ms
        if seen is greater than or equal to cap then exit repeat
        set mine to false
        try
          if (contents of dir) is "in" then
            if (sender of m) contains addr then set mine to true
          else
            repeat with r in (to recipients of m)
              if (address of r) is addr then set mine to true
            end repeat
          end if
        end try
        if mine then
          set seen to seen + 1
          set d to date received of m
          if (contents of dir) is "out" then set d to date sent of m
          set stamp to (year of d as string) & "-" & my pad((month of d) as integer) & "-" & my pad(day of d) & "T" & my pad(hours of d) & ":" & my pad(minutes of d) & ":" & my pad(seconds of d)
          set c to ""
          try
            set c to content of m
          end try
          if (length of c) is greater than 600 then set c to text 1 thru 600 of c
          set out to out & (contents of dir) & FS & stamp & FS & (sender of m) & FS & (subject of m) & FS & c & RS
        end if
      end repeat
    end repeat
  end tell
  return out
end run

on pad(n)
  if n is less than 10 then return "0" & n
  return n as string
end pad`;

const fold = (t: string, n: number): string => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
};

/** The newest `limit` messages from the script's output, newest first. A record that is not whole is dropped. */
export function parseThreadOutput(out: string, limit: number): ThreadMessage[] {
  const rows: ThreadMessage[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 5) continue;
    const [dir, at, who, subject, body] = p as [string, string, string, string, string];
    if ((dir !== "in" && dir !== "out") || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(at)) continue;
    rows.push({ at, who: who.trim(), direction: dir, subject: subject.trim(), excerpt: fold(body, 200) });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

// argv: 1 sender, 2 subject, 3 body, 4 to (LS-separated), 5 cc, 6 bcc, 7 draft id. Sends a NEW outgoing message with the
// draft's text (a saved draft is a `message`, which Mail's `send` cannot take), then moves the original draft to the Trash.
export const SEND_SCRIPT = `on run argv
  set LS to (ASCII character 29)
  set theSender to item 1 of argv
  set theSubject to item 2 of argv
  set theBody to item 3 of argv
  set tos to my parts(item 4 of argv, LS)
  set ccs to my parts(item 5 of argv, LS)
  set bccs to my parts(item 6 of argv, LS)
  set draftId to (item 7 of argv) as integer
  tell application "Mail"
    set msg to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
    if theSender is not "" then set sender of msg to theSender
    try
      set message signature of msg to missing value
    end try
    tell msg
      repeat with a in tos
        make new to recipient at end of to recipients with properties {address:(contents of a)}
      end repeat
      repeat with a in ccs
        make new cc recipient at end of cc recipients with properties {address:(contents of a)}
      end repeat
      repeat with a in bccs
        make new bcc recipient at end of bcc recipients with properties {address:(contents of a)}
      end repeat
    end tell
    set ok to send msg
    if ok is not true then error "Mail did not send the message"
    try
      delete (first message of drafts mailbox whose id is draftId)
    end try
  end tell
  return "ok"
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

/** Mail.app through osascript. Plain text only; a draft with attachments is refused before it gets here. */
export function mailAppMailer(osa: OsaRun = defaultOsa): Mailer {
  return {
    async findDrafts(q) {
      return parseFindOutput(await osa(FIND_SCRIPT, [q.subject]));
    },
    async thread(q, limit) {
      return parseThreadOutput(await osa(THREAD_SCRIPT, [threadSubject(q.subject), q.address.trim().toLowerCase(), String(THREAD_SCAN_CAP)]), limit);
    },
    async send(d) {
      const out = await osa(SEND_SCRIPT, [d.sender ?? "", d.subject, d.body, d.to.join(LS), d.cc.join(LS), d.bcc.join(LS), d.ref]);
      if (!/ok/.test(out)) throw new Error(`Mail answered "${out.trim().slice(0, 100)}"`);
      return { messageId: null };
    },
  };
}

/** Records what it was asked and never leaves the process. `failSend` makes `send` throw once. */
export class FakeMailer implements Mailer {
  drafts: MailDraft[];
  sent: MailDraft[] = [];
  failSend: string | null = null;
  finds = 0;
  /** The conversation Mail would show: filtered by subject (without Re:) and by the address of the other side. */
  messages: Array<ThreadMessage & { address: string }> = [];
  /** Makes `thread` throw once, as Mail does when it is closed or busy. */
  failThread: string | null = null;
  constructor(drafts: MailDraft[] = []) {
    this.drafts = drafts;
  }
  async findDrafts(q: DraftQuery): Promise<MailDraft[]> {
    this.finds++;
    return this.drafts.filter((d) => d.subject === q.subject);
  }
  async thread(q: ThreadQuery, limit: number): Promise<ThreadMessage[]> {
    if (this.failThread) {
      const m = this.failThread;
      this.failThread = null;
      throw new Error(m);
    }
    const base = threadSubject(q.subject).toLowerCase();
    return this.messages
      .filter((m) => m.address.toLowerCase() === q.address.trim().toLowerCase() && threadSubject(m.subject).toLowerCase().includes(base))
      .map(({ address: _address, ...m }) => m)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
  }
  async send(d: MailDraft): Promise<{ messageId: string | null }> {
    if (this.failSend) {
      const m = this.failSend;
      this.failSend = null;
      throw new Error(m);
    }
    this.sent.push(d);
    this.drafts = this.drafts.filter((x) => x.ref !== d.ref);
    return { messageId: `fake-${this.sent.length}@hub.test` };
  }
}
