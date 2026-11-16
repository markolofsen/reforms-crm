import { describe, expect, it } from "vitest";
import { API_VERSION, healthDto, type HealthDto } from "@hub/contract/health";
import type { AttentionItem, ProjectCardDto } from "@hub/contract/overview";
import { MAIL_OFF } from "./mail";
import { OFF } from "./messengers";
import { SENT_OFF } from "./sent";
import { attentionOf, verdictOf, type ProjectExtra } from "./overview-attention";

const NOW = new Date("2026-11-15T12:00:00Z");
const health = (over: Partial<HealthDto> = {}): HealthDto => healthDto.parse({ ok: true, apiVersion: API_VERSION, messengers: OFF, mail: MAIL_OFF, sent: SENT_OFF, mailer: "mail-app", ...over });

const card = (slug: string, over: Partial<ProjectCardDto> = {}): ProjectCardDto => ({
  slug,
  name: slug,
  status: "active",
  kind: "generic",
  archived: false,
  lastTriageAt: "2026-11-14T10:00:00.000Z",
  owe: { state: "off", message: "Not recorded yet." },
  drafts: { ready: 0, hold: 0, done: 0, skipped: 0, sent: 0 },
  injectionHeld: 0,
  sends: { today: 0, since: "2026-11-15T00:00:00.000Z", failed24h: 0, stuck: 0, stopped: false, auto: { mode: "draft", cap: 5, used24h: 0 } },
  recipients: "listed",
  mailboxes: [],
  notion: { clients: null, leads: null },
  setupQuestion: false,
  ...over,
});
const extra = (over: Partial<ProjectExtra> = {}): ProjectExtra => ({ doctorFailed: [], knowledgeExpired: 0, contextRequired: "warn", ...over });
const run = (cards: ProjectCardDto[], x: Record<string, ProjectExtra> = {}, system = health()) => attentionOf({ now: NOW, cards, extra: x, system });
const kinds = (items: AttentionItem[]) => items.map((i) => i.kind);
const fresh = { state: "fresh", asOf: "2026-11-15T11:50:00.000Z", value: { count: 2, since: "2026-11-01T12:00:00.000Z", mayOverstate: false } } as const;

describe("attentionOf", () => {
  it("is empty and clear for a quiet project", () => {
    const items = run([card("alpha")], { alpha: extra() });
    expect(items).toEqual([]);
    expect(verdictOf(items)).toEqual({ level: "clear", headline: "All clear" });
  });

  it("raises each blocker", () => {
    const items = run(
      [
        card("alpha", {
          mailboxes: [
            { account: "A", shared: false, newSinceTriage: { state: "off", message: "No login for this account." } },
            { account: "B", shared: false, newSinceTriage: { state: "error", code: "timeout", message: "x", fix: "y" } },
          ],
          notion: { clients: { dataSourceId: "d", count: { state: "error", code: "token-missing", message: "The Notion token is missing.", fix: "Put the token in state/secrets." } }, leads: null },
          sends: { today: 0, since: "s", failed24h: 0, stuck: 0, stopped: true, auto: { mode: "draft", cap: 5, used24h: 0 } },
        }),
      ],
      { alpha: extra({ doctorFailed: ["kind is known"] }) },
      health({ sent: { ...SENT_OFF, state: "error", failures: 3 } }),
    );
    expect(kinds(items).sort()).toEqual(["doctor-fail", "mail-error", "mail-off", "notion-token", "send-stopped", "sent-loop-error"]);
    expect(items.every((i) => i.severity === "blocker")).toBe(true);
    expect(verdictOf(items).level).toBe("blocked");
  });

  it("a missing Notion token is an error item with its fix line, never a quiet state", () => {
    const [i] = run([card("alpha", { notion: { clients: { dataSourceId: "d", count: { state: "error", code: "token-missing", message: "The Notion token is missing.", fix: "Put the token alone in state/secrets/notion-token." } }, leads: null } })], { alpha: extra() });
    expect(i).toMatchObject({ kind: "notion-token", severity: "blocker", project: "alpha", focus: "project" });
    expect(i?.sentence).toContain("state/secrets/notion-token");
  });

  it("counts injection-held drafts, ready drafts and replies owed as needing the owner, with their filters", () => {
    const items = run([card("alpha", { injectionHeld: 2, drafts: { ready: 4, hold: 1, done: 0, skipped: 0, sent: 0 }, owe: { state: "fresh", asOf: "x", value: 3 } })], { alpha: extra() });
    expect(items.map((i) => [i.kind, i.count, i.severity])).toEqual([
      ["drafts-ready", 4, "needs-owner"],
      ["owe-reply", 3, "needs-owner"],
      ["injection-flagged", 2, "needs-owner"],
    ]);
    expect(items.find((i) => i.kind === "drafts-ready")?.filter).toBe("ready");
    expect(items.find((i) => i.kind === "injection-flagged")?.focus).toBe("drafts");
  });

  it("raises the draft project, test recipients, failed and stuck sends", () => {
    const items = run(
      [
        card("alpha", { status: "draft", setupQuestion: true }),
        card("beta", { recipients: "test", sends: { today: 0, since: "s", failed24h: 2, stuck: 1, stopped: false, auto: { mode: "draft", cap: 5, used24h: 0 } } }),
      ],
      { alpha: extra(), beta: extra() },
    );
    expect(kinds(items).sort()).toEqual(["project-draft", "recipients-test", "send-failed", "sending-stuck"]);
  });

  it("a Notion read error other than the token is needs-owner", () => {
    const items = run([card("alpha", { notion: { clients: { dataSourceId: "d", count: { state: "error", code: "not-shared", message: "m", fix: "f" } }, leads: null } })], { alpha: extra() });
    expect(items).toMatchObject([{ kind: "notion-error", severity: "needs-owner", count: 1 }]);
  });

  it("watches stale numbers, the cap at 80 %, expired knowledge, a project never triaged and the context change", () => {
    const stale = { ...fresh, state: "stale" } as const;
    const items = run(
      [
        card("alpha", {
          lastTriageAt: null,
          mailboxes: [{ account: "A", shared: false, newSinceTriage: stale }],
          sends: { today: 0, since: "s", failed24h: 0, stuck: 0, stopped: false, auto: { mode: "auto", cap: 5, used24h: 4 } },
        }),
      ],
      { alpha: extra({ knowledgeExpired: 2, contextRequired: null }) },
    );
    expect(kinds(items).sort()).toEqual(["cap-near", "context-block-soon", "knowledge-expired", "never-triaged", "stale-read"]);
    expect(items.every((i) => i.severity === "watch")).toBe(true);
    expect(verdictOf(items)).toEqual({ level: "clear", headline: "All clear, 5 to watch" });
  });

  it("the cap warning needs auto mode and 80 % of the cap", () => {
    const auto = (used24h: number, mode: "auto" | "draft") => card("alpha", { sends: { today: 0, since: "s", failed24h: 0, stuck: 0, stopped: false, auto: { mode, cap: 5, used24h } } });
    expect(kinds(run([auto(3, "auto")], { alpha: extra() }))).toEqual([]);
    expect(kinds(run([auto(4, "auto")], { alpha: extra() }))).toEqual(["cap-near"]);
    expect(kinds(run([auto(5, "draft")], { alpha: extra() }))).toEqual([]);
  });

  it("raises nothing for a paused or archived project", () => {
    const items = run([card("alpha", { status: "paused", injectionHeld: 3 }), card("beta", { status: "archived", archived: true, injectionHeld: 3 })], { alpha: extra(), beta: extra() });
    expect(items).toEqual([]);
  });

  it("orders by severity, then count (more first), then project, then kind", () => {
    const items = run([card("beta", { injectionHeld: 1 }), card("alpha", { injectionHeld: 1 }), card("gamma", { injectionHeld: 5 }), card("delta", { sends: { today: 0, since: "s", failed24h: 0, stuck: 0, stopped: true, auto: { mode: "draft", cap: 5, used24h: 0 } } })], { alpha: extra(), beta: extra(), gamma: extra(), delta: extra() });
    expect(items.map((i) => `${i.severity}:${i.project}`)).toEqual(["blocker:delta", "needs-owner:gamma", "needs-owner:alpha", "needs-owner:beta"]);
  });

  it("the headline quotes what happened, not the next step, and counts what needs the owner", () => {
    const items = run([card("alpha", { injectionHeld: 1 })], { alpha: extra() });
    const v = verdictOf(items);
    expect(v.level).toBe("attention");
    expect(v.headline).toBe("1 thing needs you: alpha: 1 draft is held, suspicious mail");
  });
});
