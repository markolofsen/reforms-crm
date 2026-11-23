import { execFile } from "node:child_process";

// The one osascript runner of the Hub (P126 M1): every read, draft write, trash and send of Apple Mail goes through
// `osaWithin` with a budget named for its job. Injected as an `OsaRun` so tests never reach Mail.

/** Runs osascript with the script and its arguments (`on run argv`). */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

/**
 * The budget of each job, in ms. `read`: a read a page waits on (the Drafts card, Connections' accounts): a healthy Mail
 * answers in seconds. `long`: a send, a trash or a long read (Sent, an inbound mailbox): two minutes. `write`: a draft write,
 * well past the writer's own wait (`WRITE_WAIT_SECONDS`), so a slow Mail still ends in the script's `pending`.
 */
export const MAIL_BUDGETS = { read: 20_000, long: 120_000, write: 150_000 } as const;
export type MailJob = keyof typeof MAIL_BUDGETS;

/** The one line a page shows when Mail holds an AppleEvent past its budget (measured 2026-11-19: error -1712 after 2 min). */
export const MAIL_NOT_ANSWERING_FIX = "Quit Mail (Force Quit if it does not close), open it again, then reload this page.";

/** osascript was cut at its budget: Mail is running but did not answer (a draft write may still land). The message names no account or text. */
export class MailNotAnswering extends Error {
  readonly seconds: number;
  constructor(ms: number) {
    super(`Mail is not answering (no reply in ${Math.round(ms / 1000)} s)`);
    this.name = "MailNotAnswering";
    this.seconds = Math.round(ms / 1000);
  }
}

/**
 * osascript with its own budget: at `timeoutMs` the child is killed and the call rejects with `MailNotAnswering`. Node also
 * sets `killed` when output passes `maxBuffer`; at 32 MB that does not happen for anything the hub reads.
 */
export const osaWithin = (timeoutMs: number): OsaRun => (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as { killed?: boolean }).killed) return reject(new MailNotAnswering(timeoutMs));
      reject(new Error(String(stderr || err.message).slice(0, 300)));
    }),
  );

/** The runner of one job, at its budget. */
export const osaFor = (job: MailJob): OsaRun => osaWithin(MAIL_BUDGETS[job]);

/** macOS refused the Apple events (-1743): the one case that is a permission (P83). */
export const isNotAllowed = (message: string): boolean => /-1743\b|not authori[sz]ed to send apple events/i.test(message);
