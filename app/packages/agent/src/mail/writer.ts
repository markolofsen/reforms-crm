import { execFile } from "node:child_process";
import { ops } from "@hub/log/ops";
import { FS, LS, parseInboundOutput, parseThreadDrafts, parseWriteOutput, PS } from "./protocol";
import { ACCOUNT_ADDRESSES_SCRIPT, FIND_INBOUND_SCRIPT, MESSAGE_ID_SCRIPT, READ_CONTENT_SCRIPT, READ_HEADERS_SCRIPT, THREAD_DRAFTS_SCRIPT } from "./scripts/read";
import { WRITE_NEW_SCRIPT } from "./scripts/write-new";
import { WRITE_REPLY_SCRIPT } from "./scripts/write-reply";
import { MAIL_SLOW_TEXT, probeOf, writtenBody } from "./text";
import { DraftWriteError, type DraftWriter, type InboundMessage } from "./types";

// The hub's draft writer (P52, decision 0030; decision 0031 for what it no longer writes): an unsent reply saved in
// Mail's Drafts, written by the `hub` MCP server (outside the agent's sandbox) through Mail's own scripting, with no
// window, no focus and no clipboard. It writes the reply text and nothing else: no marker line, no hidden text (0031).
// It never sends: the script has no `send`. It finds the draft it saved as a NEW draft of this subject, in any of the
// project's accounts (Mail saves a draft in its From's account, P65 S5), whose In-Reply-To is the answered message and
// whose text starts with the written text. Its removals: the older versions the caller names by account and `message id`
// (the Hub's `mail_versions` record), each re-checked in the script just before Mail's delete (moved to the account's
// Trash by Mail), and this run's own extras (a second save of the same text, Mail's empty reply shell; decision 0031
// addendum point 4). Nothing else is ever deleted, and nothing is deleted when the new draft is not seen. Mail slow (not
// seen within the wait): the write is `mail_slow`, not failed; the caller's write record lets a late save be adopted.

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

/** How long the writer waits for Mail to show the draft it saved (P65 S5: Mail took 74 s once on 2026-11-19; past this the write is `mail_slow`). */
export const WRITE_WAIT_SECONDS = 45;

/** osascript was cut at its budget: Mail did not answer (the write may still land). */
export class OsaTimeout extends Error {}

/** osascript with a budget: well past the writer's own wait, so a slow Mail still ends in the script's `pending`. */
export const osaWithin = (timeoutMs: number): OsaRun => (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as { killed?: boolean }).killed) return reject(new OsaTimeout(`Mail did not answer within ${Math.round(timeoutMs / 1000)} s`));
      reject(new Error(String(stderr || err.message).slice(0, 300)));
    }),
  );

export const defaultOsa: OsaRun = osaWithin(150_000);

/** macOS refused the Apple events (-1743): the one case that is a permission (P83). */
export const isNotAllowed = (message: string): boolean => /-1743\b|not authori[sz]ed to send apple events/i.test(message);

/** Mail.app through osascript, run by the hub MCP server. Plain text. */
export function mailAppDraftWriter(osa: OsaRun = defaultOsa): DraftWriter {
  const fail = (e: Error) => {
    // P86: Mail's own error, never the draft's text (osascript's error names the script line, not its arguments).
    const kind = isNotAllowed(e.message) ? "mail_not_allowed" : "mail_error";
    ops("mail").error("a Mail script failed", { kind, reason: e.message.slice(0, 300) });
    if (kind === "mail_not_allowed") throw new DraftWriteError("mail_not_allowed", `macOS did not let the Hub control Mail (${e.message.slice(0, 120)}).`);
    throw new DraftWriteError("mail_error", e.message);
  };
  const readBlock = async (script: string, m: InboundMessage): Promise<string> => {
      const out = await osa(script, [m.account, m.mailboxPath.join(LS), String(m.messageId)]).catch(fail);
      const i = out.indexOf(FS);
      const head = i < 0 ? out.trim() : out.slice(0, i);
      if (head === "error") {
        const [, code = "mail_error", message = "Mail refused the header read."] = out.replace(/[\r\n]+$/, "").split(FS);
        throw new DraftWriteError(code, message);
      }
      if (head !== "ok") throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
      return out.slice(i + 1);
    };
  return {
    async writeReply(i) {
      const body = writtenBody(i.body);
      if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
      const targets = (i.replace ?? []).map((v) => `${v.account}${PS}${v.messageId.trim().replace(/^<|>$/g, "")}`).join(LS);
      const land = [...new Set([i.account, ...(i.landIn ?? [])])].join(LS);
      const out = await osa(WRITE_REPLY_SCRIPT, [i.account, i.mailboxPath.join(LS), String(i.messageId), body, i.sender ?? "", i.quote ?? "add", probeOf(body), targets, land, String(i.waitSeconds ?? WRITE_WAIT_SECONDS)]).catch((e: Error) => {
        // Cut at the budget: Mail may still save it, exactly like the script's own `pending`.
        if (e instanceof OsaTimeout) {
          ops("mail").warn("Mail did not answer a reply draft's write in time; it may still save it", { account: i.account });
          throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT);
        }
        return fail(e);
      });
      return parseWriteOutput(out);
    },
    async writeNew(i) {
      const body = writtenBody(i.body);
      if (!body.trim()) throw new DraftWriteError("empty", "The message has no text.");
      const targets = (i.replace ?? []).map((v) => `${v.account}${PS}${v.messageId.trim().replace(/^<|>$/g, "")}`).join(LS);
      const land = [...new Set([i.account, ...(i.landIn ?? [])])].join(LS);
      const out = await osa(WRITE_NEW_SCRIPT, [i.account, i.sender ?? "", i.to, i.subject, body, probeOf(body), targets, land, String(i.waitSeconds ?? WRITE_WAIT_SECONDS)]).catch((e: Error) => {
        if (e instanceof OsaTimeout) {
          ops("mail").warn("Mail did not answer a new message's write in time; it may still save it", { account: i.account });
          throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT);
        }
        return fail(e);
      });
      return parseWriteOutput(out);
    },
    async threadDrafts(accounts, thread, subject) {
      const id = thread.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return [];
      return parseThreadDrafts(await osa(THREAD_DRAFTS_SCRIPT, [id, subject ?? "", ...accounts]).catch(fail));
    },
    async findInbound(accounts, messageId) {
      const id = messageId.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return null;
      return parseInboundOutput(await osa(FIND_INBOUND_SCRIPT, [id, ...accounts]).catch(fail));
    },
    async addressesOf(account) {
      const p = (await osa(ACCOUNT_ADDRESSES_SCRIPT, [account]).catch(fail)).replace(/[\r\n]+$/, "").split(FS);
      if (p[0] !== "ok") return [];
      return (p[1] ?? "").split(LS).map((x) => x.trim()).filter(Boolean);
    },
    readContent: (m) => readBlock(READ_CONTENT_SCRIPT, m),
    readHeaders: (m) => readBlock(READ_HEADERS_SCRIPT, m),
    async messageIdOf(m) {
      const p = (await osa(MESSAGE_ID_SCRIPT, [m.account, m.mailboxPath.join(LS), String(m.messageId)]).catch(fail)).replace(/[\r\n]+$/, "").split(FS);
      if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
      const id = (p[1] ?? "").trim().replace(/^<|>$/g, "");
      if (p[0] !== "ok" || !id) throw new DraftWriteError("mail_error", "Mail gave the message no Message-ID.");
      return id;
    },
  };
}
