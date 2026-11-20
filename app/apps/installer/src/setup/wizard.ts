import { fileState, notionShapeProblem, NOTION_FILE, readValue, redact, storeToken, TELEGRAM_FILE, type Verdict } from "@hub/connections";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { loadProject } from "@hub/projects";
import path from "node:path";
import { listProjects, type Ctx } from "../context";
import { doctor, install, table } from "../runner";
import type { Step, StepReport } from "../types";
import type { Validators } from "./clients";
import type { Ui } from "./ui";
import { personalChecklist, personalText, type PersonalFacts, type PersonalItem } from "./personal";
import { personProblem, projectsOf, readPerson, situationOf, writePerson, type Situation } from "./situation";

export type StageStatus = "ok" | "stored" | "unverified" | "skipped" | "missing" | "invalid";
export interface StageResult { id: string; title: string; required: boolean; status: StageStatus; detail: string }

export interface SetupDeps {
  ui: Ui;
  validators: Validators;
  /** Environment for --non-interactive (tests pass a plain object). */
  env: Record<string, string | undefined>;
  steps: Step[];
  /** P89: Mail's account names (mail-mcp `list_accounts`); undefined when Mail cannot be asked. Absent: not asked. */
  mailAccounts?: () => Promise<string[] | undefined>;
  /** P89: ask the person's name once in a terminal when it is not set (the CLI sets it; tests of other stages leave it off). */
  askPerson?: boolean;
}
export interface SetupOptions {
  /** P89 verdict 7: the person's name for `state/person.json` (`--person`, or HUB_PERSON). */
  person?: string;
  nonInteractive: boolean;
  /** Off by default (manual-first, decision 0006): the Notion and Telegram tokens. Mail has no key (decision 0026). The caller passes the matching `deps.steps`. */
  automation?: boolean;
}
export interface SetupOutcome { stages: StageResult[]; reports: StepReport[]; ownerOnly: string[]; exitCode: number; situation?: Situation; personal?: PersonalItem[] }

/** P89: the facts of the personal checklist, from the doctor rows and the files of this Mac (a secret's value is never read). */
export async function personalFacts(ctx: Ctx, d: Pick<SetupDeps, "mailAccounts">, reports: readonly StepReport[], situation: Situation): Promise<PersonalFacts> {
  const projects = projectsOf(ctx.paths.projects);
  const projectAccounts = projects.map((p) => {
    try { return { slug: p.slug, accounts: loadProject(ctx.paths.projects, p.slug).parsed.config.mail.accounts }; } catch { return { slug: p.slug, accounts: [] }; }
  });
  const row = (id: string) => reports.find((r) => r.step.id === id);
  const okOf = (id: string) => { const r = row(id); return r ? { ok: r.outcome === "ok" || r.outcome === "changed", detail: r.detail } : undefined; };
  const sessionsDir = path.join(ctx.configDir, "sessions");
  const update = /origin has v\d+\.\d+\.\d+[^;)]*/.exec(row("instance.core")?.detail ?? "")?.[0];
  const clis = okOf("agent.clis"), autostart = okOf("autostart.agent"), person = readPerson(ctx.paths)?.name;
  return {
    situation, projectAccounts,
    ...(person ? { person } : {}),
    ...(projectAccounts.some((p) => p.accounts.length) && d.mailAccounts ? { mailAccounts: await d.mailAccounts().catch(() => undefined) } : {}),
    ...(clis ? { clis } : {}),
    ...(autostart ? { autostart } : {}),
    notionToken: existsSync(path.join(ctx.configDir, NOTION_FILE)),
    messengerSessions: existsSync(sessionsDir) ? readdirSync(sessionsDir) : [],
    ...(projects[0] ? { firstProject: projects[0].slug } : {}),
    ...(update ? { coreUpdate: update } : {}),
  };
}

class Cancelled extends Error {}
const ask = <T>(v: T | undefined): T => { if (v === undefined) throw new Cancelled(); return v; };

interface TokenSpec {
  id: string; title: string; required: boolean; name: string;
  /** Env vars read in both modes: the value itself, or `<KEY>_FILE` naming a file that holds it. */
  envKey: string;
  explain: string;
  prompt: string;
  shape?(v: string): string | undefined;
  validate(v: string): Promise<Verdict>;
}

/** A value from env or from the file the env names. Never logged. */
function fromEnv(d: SetupDeps, key: string): string | undefined {
  const direct = d.env[key]?.trim();
  if (direct) return direct;
  const file = d.env[`${key}_FILE`]?.trim();
  if (!file) return undefined;
  try { return readFileSync(file, "utf8").trim() || undefined; } catch { throw new Error(`${key}_FILE: cannot read ${file}`); }
}

function save(ctx: Ctx, name: string, value: string): void {
  if (ctx.dryRun) return;
  if (readValue(ctx.configDir, name) === value.trim()) return; // idempotent: same value, nothing to write
  storeToken(ctx.configDir, name, value);
}

const scrubbed = (v: Verdict, secret: string): Verdict => ({ ...v, detail: v.detail.split(secret).join("***") });

async function tokenStage(ctx: Ctx, d: SetupDeps, o: SetupOptions, s: TokenSpec): Promise<StageResult> {
  const res = (status: StageStatus, detail: string): StageResult => ({ id: s.id, title: s.title, required: s.required, status, detail });
  const verdictToResult = (v: Verdict, stored: boolean): StageResult =>
    v.state === "valid" ? res(stored ? "stored" : "ok", v.detail) : v.state === "unverified" ? res("unverified", `${v.detail} (stored, not verified)`) : res("invalid", v.detail);

  // 1. A value handed in through the environment wins (both modes).
  const given = fromEnv(d, s.envKey);
  if (given) {
    const bad = s.shape?.(given);
    if (bad) return res("invalid", `${s.envKey}: ${bad}`);
    const v = scrubbed(await s.validate(given), given);
    if (v.state === "invalid") return res("invalid", `${s.envKey}: ${v.detail}`);
    save(ctx, s.name, given);
    return verdictToResult(v, true);
  }

  // 2. Already stored: tighten the mode, re-check, keep.
  const file = path.join(ctx.configDir, s.name);
  if (fileState(ctx.configDir, s.name).state === "unsafe-mode" && !ctx.dryRun) chmodSync(file, 0o600); // tighten the mode, then read it
  const stored = readValue(ctx.configDir, s.name);
  if (stored) {
    const v = await s.validate(stored);
    if (v.state !== "invalid") return v.state === "valid" ? res("ok", `already stored; ${v.detail}`) : res("unverified", `already stored; ${v.detail}`);
    if (o.nonInteractive) return res("invalid", `stored value rejected: ${v.detail}`);
    d.ui.warn(`${s.title}: the stored value is rejected (${v.detail}).`);
    if (!ask(await d.ui.confirm("Replace it with a new one?", true))) return res("invalid", `stored value rejected: ${v.detail}`);
  } else if (o.nonInteractive) {
    return res(s.required ? "missing" : "skipped", `set ${s.envKey} (or ${s.envKey}_FILE)${s.required ? "" : "; optional"}`);
  } else if (!s.required) {
    const c = ask(await d.ui.choose(`${s.title}: set it up now?`, [{ value: "yes", label: "Yes, set up now" }, { value: "no", label: "Skip (optional, run setup again any time)" }]));
    if (c === "no") return res("skipped", "optional, skipped");
  }

  // 3. Ask, validate, store.
  d.ui.note(s.explain, s.title);
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = ask(await d.ui.password(`${s.prompt} (hidden; empty = later)`)).trim();
    if (!raw) return res(s.required ? "missing" : "skipped", "left for later: run `pnpm hub setup` again");
    const bad = s.shape?.(raw);
    if (bad) { d.ui.warn(bad); continue; }
    const v = scrubbed(await s.validate(raw), raw);
    if (v.state === "invalid") { d.ui.warn(`${v.detail}. Try again, or press Enter to leave it for later.`); continue; }
    if (v.state === "unverified" && !ask(await d.ui.confirm(`${v.detail}. Store it without checking?`, true))) continue;
    save(ctx, s.name, raw);
    return verdictToResult(v, true);
  }
  return res("invalid", "three attempts rejected; nothing stored");
}

function specs(d: SetupDeps): TokenSpec[] {
  const v = d.validators;
  return [
    {
      id: "notion.token", title: "Notion integration token", required: true, name: NOTION_FILE, envKey: "HUB_NOTION_TOKEN",
      explain: "1. Open https://www.notion.so/profile/integrations and create an internal integration (read content).\n2. Copy its secret (ntn_...) and paste it here; it is checked with GET /users/me.\n3. Afterwards, on each CRM root page: Connections > add the integration (Notion has no API for this step).",
      prompt: "Paste the Notion token", shape: notionShapeProblem, validate: (t) => v.notion(t),
    },
    {
      id: "messengers.token", title: "Telegram bot token (optional)", required: false, name: TELEGRAM_FILE, envKey: "HUB_TELEGRAM_TOKEN",
      explain: "Make a NEW bot just for this app: open @BotFather, send /newbot, copy the token. Never reuse a bot that has a webhook: a webhook and polling exclude each other.\nChecked with getMe; stored in state/secrets/telegram-bot-token (mode 600).",
      prompt: "Paste the bot token", validate: (t) => v.telegram(t),
    },
  ];
}

const FIXED_OWNER_ONLY = [
  "Notion: share each CRM root page with the integration (Connections); Notion has no API for it.",
  "macOS: approve the Automation / Accessibility prompt for mail-mcp the first time it appears; a script cannot grant it.",
];
const MANUAL_OWNER_ONLY = [
  "macOS: approve the Automation / Accessibility prompt for mail-mcp the first time it asks; a script cannot grant it.",
  "Notion: sign in to the connector once (`/mcp` in Claude Code, Settings > Connectors in Claude Desktop).",
];

/** The whole wizard. Resumable (every stage looks at what is on disk) and idempotent (rerun changes nothing). */
export async function runSetup(ctx: Ctx, d: SetupDeps, o: SetupOptions): Promise<SetupOutcome> {
  const stages: StageResult[] = [];
  let reports: StepReport[] = [];
  let situation: Situation = "new";
  const { ui } = d;
  try {
    ui.intro(`Hub Workflow setup${o.automation ? " + automation" : " (manual sessions, no tokens)"}${ctx.dryRun ? " (dry run: nothing is written)" : ""}${o.nonInteractive ? " (non-interactive)" : ""}`);

    // 1. Private folder.
    if (!ctx.dryRun) {
      mkdirSync(ctx.configDir, { recursive: true, mode: 0o700 });
      chmodSync(ctx.configDir, 0o700);
    }
    ui.info(`${ctx.dryRun ? "would use" : "using"} ${ctx.configDir} (mode 700)`);

    // P89: the situation in one sentence, then the person (asked once, kept on this Mac only).
    const sit = situationOf(ctx.paths);
    situation = sit.situation;
    ui.info(sit.sentence);
    const given = o.person ?? d.env.HUB_PERSON;
    if (given !== undefined && given.trim()) {
      const bad = personProblem(given);
      if (bad) ui.warn(`--person: ${bad}; not stored`);
      else if (!ctx.dryRun) { writePerson(ctx.paths, given); ui.info(`your name: ${given.trim()} (state/person.json, this Mac only)`); }
    } else if (d.askPerson && !readPerson(ctx.paths) && !o.nonInteractive) {
      const n = (await d.ui.text("Your name, as your team sees it on a client in Notion (\"Last sent by\"); kept on this Mac only, Enter to skip")) ?? "";
      if (n.trim() && !personProblem(n) && !ctx.dryRun) writePerson(ctx.paths, n);
    }

    // 2-3. Automation only: tokens in the order the owner asked: Notion, Telegram. Mail needs none: Apple Mail is the path.
    if (o.automation) {
      for (const s of specs(d)) {
        const r = await tokenStage(ctx, d, o, s);
        stages.push(r);
        ui.info(`${s.title}: ${r.status}. ${redact(ctx.configDir, r.detail)}`);
      }
    }

    // 5. Projects: the interview belongs to a skill.
    const projects = listProjects(ctx);
    const proj = projects.length
      ? `Projects: ${projects.join(", ")}.`
      : "No project yet. Run `hub agent new` and say \"настрой проект <имя>\": the `project-setup` skill asks the questions and writes <instance>/projects/<slug>/project.md.";
    ui.info(proj);
    stages.push({ id: "projects", title: "Project", required: false, status: projects.length ? "ok" : "skipped", detail: proj });

    // 6. The install steps (folders, config, skills, project registry), then the doctor table.
    const hardStop = o.nonInteractive && stages.some((s) => s.required && (s.status === "missing" || s.status === "invalid"));
    if (hardStop) {
      ui.warn("Required items are missing or rejected; the install steps were not run (they would check things that cannot work).");
    } else {
      const done = await install(ctx, d.steps);
      const failed = done.filter((r) => r.outcome === "failed");
      if (failed.length) ui.warn(`install steps failed: ${failed.map((r) => r.step.id).join(", ")}`);
    }
    reports = await doctor(ctx, d.steps);
    ui.note(table(reports), "Doctor");
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
    ui.warn("Stopped. Nothing is half-written; run `pnpm hub setup` again to continue where you left off.");
    return { stages, reports, ownerOnly: [], exitCode: 1 };
  }

  const ownerOnly = [
    ...stages.filter((s) => s.required && s.status !== "ok" && s.status !== "stored" && s.status !== "unverified").map((s) => `${s.id}: ${s.detail}`),
    ...reports.filter((r) => (r.outcome === "manual" || r.outcome === "failed") && r.step.manual).map((r) => `${r.step.id}: ${r.detail}`),
    ...(o.automation ? FIXED_OWNER_ONLY : MANUAL_OWNER_ONLY),
  ];
  ui.note(ownerOnly.map((l) => `- ${l}`).join("\n"), "Still owner-only");
  const personal = personalChecklist(await personalFacts(ctx, d, reports, situation));
  ui.note(personalText(personal, situation), "Personal on this Mac (yours to do; nothing here is typed for you)");
  const missing = stages.filter((s) => s.required && (s.status === "missing" || s.status === "invalid"));
  if (o.nonInteractive && missing.length) {
    ui.outro(`Failed. Fix and rerun:\n${missing.map((s) => `- ${s.id}: ${s.detail}`).join("\n")}`);
    return { stages, reports, ownerOnly, exitCode: 1, situation, personal };
  }
  const failedSteps = reports.some((r) => r.outcome === "failed");
  if (!o.automation) ui.outro(failedSteps ? "Setup left items open: `hub doctor` names them, each with its fix." : "ready: run hub agent");
  else ui.outro(missing.length ? "Setup paused: rerun `pnpm hub setup --automation` to finish." : "Setup finished. `pnpm hub doctor --automation` shows the table any time.");
  return { stages, reports, ownerOnly, exitCode: missing.length || failedSteps ? 1 : 0, situation, personal };
}
