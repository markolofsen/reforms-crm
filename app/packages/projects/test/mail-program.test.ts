import { describe, expect, it } from "vitest";
import { runsMailProgram } from "../src/audit";

describe("audit: a mail-sending program is judged by command position", () => {
  it("does not convict a word inside a JSON payload (the S5 false positives)", () => {
    expect(runsMailProgram(`echo '{"email":"robot@mail.example.com","reason":"Owner test mail"}' | (cd app && pnpm hub sequences judge --project x)`)).toBe(false);
    expect(runsMailProgram(`echo "a mail from acme" > notes.txt`)).toBe(false);
    expect(runsMailProgram("ls state/mail")).toBe(false);
  });
  it("still convicts a real run, however it is prefixed or chained", () => {
    expect(runsMailProgram("sendmail -t < draft.txt")).toBe(true);
    expect(runsMailProgram("mail -s hi a@example.com")).toBe(true);
    expect(runsMailProgram("cd /tmp && FOO=1 swaks --to a@example.com")).toBe(true);
    expect(runsMailProgram("sudo /usr/bin/mailx a@example.com")).toBe(true);
    expect(runsMailProgram(`cat x | osascript -e 'tell app "Mail"'`)).toBe(true);
    expect(runsMailProgram(`bash -c "sendmail -t < d"`)).toBe(true);
    expect(runsMailProgram("$(sendmail -t < d)")).toBe(true);
  });
});
