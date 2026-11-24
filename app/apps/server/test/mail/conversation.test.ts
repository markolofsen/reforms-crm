import { describe, expect, it } from "vitest";
import type { OsaRun } from "@hub/mail-app/osa";
import { baseSubject, parseHistory, readHistory } from "@hub/mail-app/history";
import { FROM_SCRIPT, SENT_TO_SCRIPT } from "@hub/mail-app/scripts/history";
import { bodyCache, threadsOf } from "../../src/mail/conversation";

const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";
/** One record as the scripts print it: Mail's id, Message-ID, In-Reply-To, References, sender, "y,m,d,seconds", subject. */
const rec = (id: number, mid: string, irt: string, refs: string, from: string, day: number, subject: string) => [id, `<${mid}>`, irt ? `<${irt}>` : "", refs, from, `2026,11,${day},3600`, subject].join(FS);

describe("P99 S1 the conversation read (fake osa, never Mail)", () => {
  it("reads their messages by sender, then ours from Sent narrowed by the thread subjects, every account, one Message-ID once", async () => {
    const calls: Array<{ script: string; args: string[] }> = [];
    const osa: OsaRun = async (script, args) => {
      calls.push({ script, args });
      if (script === FROM_SCRIPT && args[1] === "INBOX") return ["ok", rec(1, "h1@g", "", "", "Mark Effect <m@x.example>", 14, "Hello"), rec(2, "w1@g", "", "", "m@x.example", 19, "Wow")].join(RS) + RS;
      if (script === FROM_SCRIPT) return "nobox";
      if (script === SENT_TO_SCRIPT) return [`ok${FS}[Gmail]/Sent Mail`, rec(9, "s1@us", "h1@g", "<h1@g>", "Us <hello@us.example>", 19, "Re: Hello"), rec(9, "s1@us", "h1@g", "<h1@g>", "hello@us.example", 19, "Re: Hello")].join(RS) + RS;
      return "";
    };
    const msgs = await readHistory(osa, { accounts: ["hello@us.example"], inboundBoxes: ["INBOX", "hub/client"], sentMailbox: "Sent Mail", address: "M@x.example", subjects: ["Re: Price"] });
    expect(msgs.map((m) => [m.messageId, m.ours, m.mailbox])).toEqual([
      ["h1@g", false, "INBOX"],
      ["w1@g", false, "INBOX"],
      ["s1@us", true, "[Gmail]/Sent Mail"],
    ]);
    const sent = calls.find((c) => c.script === SENT_TO_SCRIPT);
    expect(sent?.args.slice(0, 3)).toEqual(["hello@us.example", "Sent Mail", "m@x.example"]);
    expect(sent?.args[3]?.split(LS).sort()).toEqual(["hello", "price", "wow"]);
  });

  it("a person with no history reads nothing from Sent and answers no messages", async () => {
    const calls: string[] = [];
    const osa: OsaRun = async (script) => {
      calls.push(script);
      return "ok" + RS;
    };
    expect(await readHistory(osa, { accounts: ["a"], inboundBoxes: ["INBOX"], sentMailbox: "Sent", address: "x@y.example", subjects: [] })).toEqual([]);
    expect(calls).toEqual([FROM_SCRIPT]);
  });

  it("threads by the headers only: a root never joins by subject, an orphan joins the newest thread of its subject, newest thread last (P140 R1)", () => {
    const m = (messageId: string, date: string, subject: string, inReplyTo: string | null = null, references: string[] = []) => ({ messageId, date, subject, inReplyTo, references });
    const groups = threadsOf([
      m("h1", "2026-11-14T10:00Z", "Hello"),
      m("s1", "2026-11-19T10:00Z", "Re: Hello", "h1", ["h1"]),
      m("h2", "2026-11-20T10:00Z", "Re: Hello", "s1", ["h1", "s1"]),
      m("w1", "2026-11-19T11:00Z", "Wow"),
      m("w2", "2026-11-21T08:38Z", "Re: Wow", "gone", ["gone"]),
      m("n1", "2026-11-24T03:31Z", "hello"),
      m("r1", "2026-11-24T12:42Z", "Re: hello", "n1", ["n1"]),
    ]);
    expect(groups.map((g) => g.map((x) => x.messageId))).toEqual([
      ["h1", "s1", "h2"],
      ["w1", "w2"],
      ["n1", "r1"],
    ]);
    expect(groups.at(-1)!.at(-1)!.messageId).toBe("r1");
    expect(baseSubject("Re: Fwd: RE[2]: Wow  now")).toBe("wow now");
  });

  it("parses a missing mailbox as null and skips a record without a Message-ID", () => {
    expect(parseHistory("nobox", "a", "hub/client", false)).toBeNull();
    expect(parseHistory(["ok", rec(1, "", "", "", "a@b", 1, "x")].join(RS), "a", "INBOX", false)).toEqual([]);
  });

  it("keeps bodies in memory only, for a while, and drops the oldest past its size", () => {
    let t = 0;
    const c = bodyCache(() => t);
    c.set("k", "text");
    expect(c.get("k")).toBe("text");
    t += 16 * 60_000;
    expect(c.get("k")).toBeNull();
  });
});
