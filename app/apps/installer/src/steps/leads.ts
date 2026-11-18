// The `Leads` group (P46): a lead must never stop silently. Read only by default (GET of each form's page, its scripts and its endpoint);
// `--canary` adds one signed canary POST per form, sent only to a handler that says it understands it. Never a real submission.
import { sendCanary } from "../leads/canary";
import { loadLeadForms, type LeadForm, type LeadForms } from "../leads/config";
import { checkRegistry } from "../leads/registry";
import { errText, limits } from "../leads/net";
import { probeForm } from "../leads/probe";
import { checkSilence } from "../leads/silence";
import type { Ctx } from "../context";
import type { CheckResult, Level, Step } from "../types";
import { fail, pass, warn } from "./helpers";

const RANK: Record<Level, number> = { pass: 0, warn: 1, fail: 2 };
const worst = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);
const FILE = "config/lead-forms.json";

/**
 * One form: the GET half and the silence check at the same time, then (with `--canary`) the canary. Every request has its own timeout and one
 * retry (`leads/net.ts`); the form as a whole stops at `limits.formMs`. The result carries the form's own wall time: the rows of a group are
 * started together, so the runner's clock would show 0.0 s for every row after the first. Nothing here throws.
 */
export async function checkForm(ctx: Ctx, cfg: LeadForms, form: LeadForm): Promise<CheckResult> {
  const t0 = Date.now();
  const deadline = AbortSignal.timeout(limits.formMs);
  const silence = checkSilence(ctx, form.silence).catch((e) => ({ level: "warn" as const, detail: `silence not checked: ${errText(e)}` }));
  let level: Level;
  let detail: string;
  try {
    const p = await probeForm(ctx.fetch, form, deadline);
    level = p.ok ? "pass" : p.level ?? "fail";
    detail = p.ok ? p.notes.join(", ") : `${p.problem}${p.notes.length ? ` (so far: ${p.notes.join(", ")})` : ""}`;
  } catch (e) { level = "fail"; detail = `check failed: ${errText(e)}`; }
  if (ctx.canary) {
    try {
      const c = await sendCanary(ctx.fetch, cfg, form, ctx.configDir, deadline);
      level = worst(level, c.level); detail = `${detail}; ${c.detail}`;
    } catch (e) { level = "fail"; detail = `${detail}; canary failed: ${errText(e)}`; }
  }
  const s = await silence;
  if (s) { level = worst(level, s.level); detail = `${detail}; ${s.detail}`; }
  return { level, detail, ms: Date.now() - t0 };
}

const formWhy = "A public form whose page, script, CSP, proxy or endpoint broke takes no lead and tells nobody; the in-process tests of the site cannot see DNS, CSP, a proxy or Cloudflare.";
const formVerifies = "GET only: the page answers 200; a static form carries its listed fields; the page or its own scripts reference the endpoint; the page's CSP lets a script reach it; Turnstile, when configured, is on the page with its sitekey and allowed by the CSP; the endpoint answers a GET with no 404 or 5xx. Silence (`silence.source` `notion-leads` or `mailbox`, read only): a lead arrived within `silence.days` (or max(14, 3 x the median gap of the last 90 days)), else a WARN, never a FAIL. With `--canary`: the signed canary is stored, a recipient resolves and the route is configured (`{stored, recipient_ok, route_ok}`); a handler without canary support is a WARN and gets no POST. Each request 5 s with one retry on a network failure, a form at most 25 s, all forms at once; the row shows the form's own time.";

/** One row for every form, for `install` and a doctor run that does not expand: the worst level, the rows that are not PASS. */
async function summary(ctx: Ctx): Promise<CheckResult> {
  const l = loadLeadForms(ctx.paths.leadForms);
  if (l.state === "invalid") return pass("not checked (see leads.config)");
  if (l.state !== "ok" || !l.config.forms.length) return pass("no forms listed");
  const cfg = l.config;
  const rs = await Promise.all(cfg.forms.map((f) => checkForm(ctx, cfg, f)));
  const bad = cfg.forms.map((f, i) => ({ f, r: rs[i]! })).filter((x) => x.r.level !== "pass");
  const level = rs.reduce<Level>((a, r) => worst(a, r.level), "pass");
  return { level, detail: bad.length ? bad.map((x) => `${x.f.id}: ${x.r.detail}`).join(" | ") : `${rs.length} forms answer` };
}

function formStep(id: string, title: string, check: (ctx: Ctx) => Promise<CheckResult>): Step {
  return {
    id, group: "Leads", title, why: formWhy, verifies: formVerifies, check,
    manual: { steps: ["Read the row: it names the first thing that failed (page, field, endpoint reference, CSP, Turnstile, endpoint route, canary).", "Fix it in the site that owns the form, deploy, and run `hub doctor --only Leads` again (`--canary` before you report done)."] },
  };
}

export const leadSteps: Step[] = [
  {
    id: "leads.config", group: "Leads", title: "Lead form list parses",
    why: "Every public lead form of the instance is one entry in `config/lead-forms.json`; a file that does not parse checks nothing.",
    verifies: "`config/lead-forms.json` is valid when present (each form has an id, domain, page and endpoint; a signed canary names its secret file by `secretRef`, never the secret). No file: PASS, the instance lists no forms.",
    manual: { steps: ["Fix the error the row names in `config/lead-forms.json` (shape: `@docs/core/22-lead-forms.md`)."] },
    async check(ctx) {
      const l = loadLeadForms(ctx.paths.leadForms);
      if (l.state === "missing") return pass(`no ${FILE}: this instance lists no public lead forms`);
      if (l.state === "invalid") return fail(`${FILE}: ${l.error}`);
      return pass(`${l.config.forms.length} forms, ${l.config.none.length} domains without a form`);
    },
  },
  {
    id: "leads.registry", group: "Leads", title: "Every registry domain has a form entry or an explicit none",
    why: "A new site with a form that nobody listed is never checked. The site registry is the list of public sites; this compares it with the form list.",
    verifies: "Every host in the first column of the registry named by `registry` in `config/lead-forms.json` is a form's `domain` or is listed under `none` with a reason. WARN, never FAIL, naming each uncovered host.",
    manual: { steps: ["For each host the row names: add its form to `config/lead-forms.json`, or add it under `none` with the reason (no form, or another instance checks it)."] },
    async check(ctx) {
      const l = loadLeadForms(ctx.paths.leadForms);
      if (l.state !== "ok") return pass(`nothing to compare (see leads.config)`);
      const r = checkRegistry(l.config, ctx.root);
      if (r.state === "unset") return pass("no registry named in config/lead-forms.json");
      if (r.state === "missing") return warn(`registry ${r.file} not found`);
      return r.uncovered.length
        ? warn(`${r.uncovered.length} of ${r.total} registry domains have no form and no none: ${r.uncovered.join(", ")}`)
        : pass(`${r.total} registry domains: each has a form or a none`);
    },
  },
  {
    ...formStep("leads.forms", "Each public lead form answers (one row per form)", summary),
    async expand(ctx) {
      const l = loadLeadForms(ctx.paths.leadForms);
      if (l.state !== "ok" || !l.config.forms.length) return [formStep("leads.forms", "Each public lead form answers (one row per form)", summary)];
      const cfg = l.config;
      // Started together on the first row's check, so the group takes as long as the slowest form, not the sum.
      let started: Promise<CheckResult>[] | undefined;
      const all = () => (started ??= cfg.forms.map((f) => checkForm(ctx, cfg, f)));
      return cfg.forms.map((f, i) => formStep(`leads.${f.id}`, `Lead form ${f.id} (${f.domain})`, () => all()[i]!));
    },
  },
];
