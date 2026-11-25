import { describe, expect, it } from "vitest";
import { moveToJunk, parseJunkOutput } from "../src/junk";

// P147 3m item 1: one inbound message to Junk, by its account, mailbox and bare Message-ID; nothing else is touched.

describe("the move to Junk", () => {
  it("reads the script's answer", () => {
    expect(parseJunkOutput("ok\n")).toEqual({ moved: true });
    expect(parseJunkOutput("missing\tthe message is no longer in INBOX")).toEqual({ moved: false, why: "the message is no longer in INBOX" });
    expect(parseJunkOutput("")).toEqual({ moved: false, why: "Mail did not answer" });
  });
  it("passes the account, the mailbox and the bare Message-ID, and nothing more", async () => {
    const calls: string[][] = [];
    const r = await moveToJunk(async (_s, args) => (calls.push(args), "ok"), { account: "Work", mailbox: "INBOX", messageId: "<abc@x.test>" });
    expect(r).toEqual({ moved: true });
    expect(calls).toEqual([["Work", "INBOX", "abc@x.test"]]);
  });
});
