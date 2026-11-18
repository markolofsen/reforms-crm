import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_STOP_ON, findSequence, isUsable, loadSequences, parseSequence, pickSequence, scheduleOf, sequenceErrors, type SequenceDefinition } from "../src";

const fixture = (name: string) => parseSequence(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"), name);
const errors = (d: SequenceDefinition) => d.issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("golden definition files", () => {
  it("valid.md parses with no issue", () => {
    const d = fixture("valid.md");
    expect(d.issues).toEqual([]);
    expect(d).toMatchObject({ id: "valid", name: "Enquiry with no answer", status: "Draft", appliesTo: ["Lead", "Client"], mailClasses: ["client"], languages: ["en"], businessDays: true, enrolAfterDays: 2 });
    expect(d.steps).toEqual([
      { n: 1, after: 2, purpose: "Check the answer arrived", adds: "one detail they asked about", topics: ["pricing"] },
      { n: 2, after: 3, purpose: "Close the file politely", adds: "an easy way back", topics: ["contact", "hours"] },
    ]);
    expect(d.stopOn).toEqual([...CORE_STOP_ON, "out_of_office"]);
    expect(d.optOut).toBe("If you would rather I stop writing, just say so.");
    expect(scheduleOf(d)).toEqual({ delays: [2, 3], businessDays: true });
    expect(isUsable(d)).toBe(true);
  });
  it("missing-steps.md is an error: no Steps section", () => {
    const d = fixture("missing-steps.md");
    expect(errors(d)).toContain('missing section "Steps"');
    expect(isUsable(d)).toBe(false);
  });
  it("bad-delay.md is an error naming the row", () => {
    expect(errors(fixture("bad-delay.md"))).toEqual(['Steps row 2: after "three" is not a whole number of days from 1 to 60']);
  });
  it("unknown-stop.md is an error naming the reason", () => {
    expect(errors(fixture("unknown-stop.md")).join()).toMatch(/stop_on "meeting_booked" is not a stop reason/);
  });
  it("stop-removed.md is an error: a file may add a stop, never remove one", () => {
    expect(errors(fixture("stop-removed.md"))).toEqual(['stop_on leaves out "replied": a file may add a stop reason, never remove one of the core\'s']);
    // the core minimum still applies to what is stored
    expect(fixture("stop-removed.md").stopOn).toContain("replied");
  });
  it("a file without stop_on gets the core minimum, and with no front matter is one error", () => {
    const d = parseSequence(readFileSync(join(import.meta.dirname, "fixtures", "valid.md"), "utf8").replace(/^stop_on:.*\n/m, ""), "x.md");
    expect(d.stopOn).toEqual([...CORE_STOP_ON]);
    expect(errors(parseSequence("# nothing", "y.md"))).toEqual(["no front matter (a block between two `---` lines at the top)"]);
  });
  it("two steps without an opt-out line is an error; bad status and applies_to are errors", () => {
    const text = readFileSync(join(import.meta.dirname, "fixtures", "valid.md"), "utf8");
    expect(errors(parseSequence(text.replace(/## Opt-out line[\s\S]*$/, ""), "z.md"))).toContain('missing section "Opt-out line": steps 2 and later carry one plain opt-out sentence');
    const bad = parseSequence(text.replace("status: Draft", "status: Live").replace('["Lead", "Client"]', '["Partner"]'), "w.md");
    expect(errors(bad)).toEqual(expect.arrayContaining(['status "Live" is not one of Draft, Active, Retired', 'applies_to "Partner" is not one of Lead, Client']));
  });
});

describe("loading and choosing", () => {
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-seq-"));
    mkdirSync(join(dir, "sequences"));
    const text = readFileSync(join(import.meta.dirname, "fixtures", "valid.md"), "utf8");
    writeFileSync(join(dir, "sequences", "a-leads.md"), text.replace('["Lead", "Client"]', '["Lead"]'));
    writeFileSync(join(dir, "sequences", "b-clients.md"), text.replace("name: Enquiry with no answer", "name: Clients").replace("status: Draft", "status: Active").replace('["Lead", "Client"]', '["Client"]'));
    writeFileSync(join(dir, "sequences", "c-retired.md"), text.replace("name: Enquiry with no answer", "name: Old").replace("status: Draft", "status: Retired"));
    writeFileSync(join(dir, "sequences", "README.md"), "not a sequence");
    return dir;
  };
  it("reads every file but README, with a hash, sorted", () => {
    const all = loadSequences(folder());
    expect(all.map((d) => d.id)).toEqual(["a-leads", "b-clients", "c-retired"]);
    expect(all.every((d) => /^[0-9a-f]{64}$/.test(d.hash))).toBe(true);
    expect(sequenceErrors(all)).toBe(0);
    expect(findSequence(all, "b-clients")?.name).toBe("Clients");
    expect(loadSequences(join(tmpdir(), "no-such-project-folder"))).toEqual([]);
  });
  it("offers the sequence that fits the page kind and class, Active first, never Retired", () => {
    const all = loadSequences(folder());
    expect(pickSequence(all, { mailClass: "client", notionKind: "lead" })?.id).toBe("a-leads");
    expect(pickSequence(all, { mailClass: "client", notionKind: "client" })?.id).toBe("b-clients");
    expect(pickSequence(all, { mailClass: "client", notionKind: "none" })?.id).toBe("b-clients");
    expect(pickSequence(all, { mailClass: "billing", notionKind: "lead" })).toBeNull();
    expect(pickSequence(all.filter((d) => d.status === "Retired"), { mailClass: "client", notionKind: null })).toBeNull();
  });
  it("two files with one name: the second is an error", () => {
    const dir = folder();
    writeFileSync(join(dir, "sequences", "d-dup.md"), readFileSync(join(dir, "sequences", "a-leads.md"), "utf8"));
    expect(sequenceErrors(loadSequences(dir))).toBe(1);
  });
});
