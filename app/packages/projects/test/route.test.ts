import { describe, expect, it } from "vitest";
import { parseProjectMd } from "../src/parse";
import { registryEntry, resolveProject, type RegistryProject } from "../src/route";

const reg: RegistryProject[] = [
  { slug: "acme", status: "active", accounts: ["owner@acme.example"], addresses: ["owner@acme.example", "hello@acme.example"] },
  { slug: "nordhaus", status: "active", accounts: ["owner@acme.example"], addresses: ["office@nordhaus.example"] },
  { slug: "solo", status: "active", accounts: ["solo-account"], addresses: ["solo@solo.example"] },
  { slug: "sleepy", status: "paused", accounts: ["sleepy-account"], addresses: ["hi@sleepy.example"] },
  { slug: "wip", status: "draft", accounts: [], addresses: ["wip@wip.example"] },
];

describe("resolveProject", () => {
  const cases: Array<[string, { account: string; recipients: string[] }, object]> = [
    ["recipient equals an address", { account: "solo-account", recipients: ["solo@solo.example"] }, { outcome: "project", project: "solo" }],
    ["alias wins over a shared account", { account: "owner@acme.example", recipients: ["Office@Nordhaus.example"] }, { outcome: "project", project: "nordhaus" }],
    ["the form-lead address routes like any mail", { account: "owner@acme.example", recipients: ["hello@acme.example"] }, { outcome: "project", project: "acme" }],
    ["+tag is stripped, case ignored", { account: "x", recipients: ["Hello+Website@ACME.example"] }, { outcome: "project", project: "acme" }],
    ["display name around the address", { account: "x", recipients: ['"Sam" <solo@solo.example>'] }, { outcome: "project", project: "solo" }],
    ["a single-project account routes with no recipient match", { account: "Solo-Account", recipients: ["list@elsewhere.example"] }, { outcome: "project", project: "solo" }],
    ["a shared account without an alias is ambiguous", { account: "owner@acme.example", recipients: ["bounce@elsewhere.example"] }, { outcome: "ambiguous", candidates: ["acme", "nordhaus"] }],
    ["nothing matches", { account: "other", recipients: ["a@b.example"] }, { outcome: "unrouted" }],
    ["a paused project gets no run and no question", { account: "sleepy-account", recipients: ["hi@sleepy.example"] }, { outcome: "inactive", project: "sleepy", status: "paused" }],
    ["a draft project is not routable", { account: "x", recipients: ["wip@wip.example"] }, { outcome: "inactive", project: "wip", status: "draft" }],
    ["two recipients, one matches", { account: "x", recipients: ["nobody@x.example", "solo@solo.example"] }, { outcome: "project", project: "solo" }],
    ["an empty account never matches", { account: "", recipients: [] }, { outcome: "unrouted" }],
  ];
  it.each(cases)("%s", (_name, msg, want) => {
    expect(resolveProject(msg, reg)).toEqual(want);
  });

  it("two active projects claiming one address are ambiguous (the sync refuses this; the router is still safe)", () => {
    const dup: RegistryProject[] = [
      { slug: "a", status: "active", accounts: [], addresses: ["x@x.example"] },
      { slug: "b", status: "active", accounts: [], addresses: ["x@x.example"] },
    ];
    expect(resolveProject({ account: "", recipients: ["x@x.example"] }, dup)).toEqual({ outcome: "ambiguous", candidates: ["a", "b"] });
  });

  it("an alias listed in mail.aliases routes like an address, old and new alike (team@ -> info@ switch)", () => {
    const c = parseProjectMd(
      "# m\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-14 | agent |\n| status | active | 2026-11-14 | owner |\n| mail.accounts | team@m.example | 2026-11-14 | agent |\n| mail.addresses | team@m.example | 2026-11-14 | owner |\n| mail.aliases | info@m.example | 2026-11-14 | owner |\n| tone | plain | 2026-11-14 | owner |\n",
      "m",
    ).config;
    const r = [registryEntry(c)];
    expect(resolveProject({ account: "info@m.example", recipients: ["team@m.example"] }, r)).toEqual({ outcome: "project", project: "m" });
    expect(resolveProject({ account: "x", recipients: ["Info@M.example"] }, r)).toEqual({ outcome: "project", project: "m" });
  });
});
