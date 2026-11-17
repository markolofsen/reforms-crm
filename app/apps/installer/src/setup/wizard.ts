import { fileState, mailFileOf, notionShapeProblem, NOTION_FILE, readValue, redact, storeMailLogin, storeToken, TELEGRAM_FILE, type Verdict } from "@hub/connections";
import { loadAccounts, parseAccount } from "@hub/mail/imap";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listProjects, type Ctx } from "../context";
import { doctor, install, table } from "../runner";
import type { Step, StepReport } from "../types";
import type { Validators } from "./clients";
import type { Ui } from "./ui";

export type StageStatus = "ok" | "stored" | "unverified" | "skipped" | "missing" | "invalid";
export interface StageResult { id: string; title: string; required: boolean; status: StageStatus; detail: string }

export interface SetupDeps {
  ui: Ui;
  validators: Validators;
  /** Environment for --non-interactive (tests pass a plain object). */
  env: Record<string, string | undefined>;
  steps: Step[];
}
export interface SetupOptions {
  nonInteractive: boolean;
  /** Off by default (manual-first, decision 0006): tokens, mail login. The caller passes the matching `deps.steps`. */
  automation?: boolean;
}
export interface SetupOutcome { stages: StageResult[]; reports: StepReport[]; ownerOnly: string[]; exitCode: number }

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

async function mailStage(ctx: Ctx, d: SetupDeps, o: SetupOptions): Promise<StageResult> {
  const base = { id: "mail.login", title: "Mail login (IMAP, read-only; optional)", required: false };
  const res = (status: StageStatus, detail: string): StageResult => ({ ...base, status, detail });
  const lines: string[] = [];
  let worst: StageStatus = "ok";
  const rank: StageStatus[] = ["ok", "stored", "unverified", "skipped", "invalid"];
  const note = (status: StageStatus, line: string) => { lines.push(line); if (rank.indexOf(status) > rank.indexOf(worst)) worst = status; };

  const { accounts, problems } = loadAccounts(ctx.configDir);
  for (const pr of problems) note("invalid", pr);
  for (const a of accounts) {
    const v = await d.validators.imap(a);
    note(v.state === "valid" ? "ok" : v.state === "invalid" ? "invalid" : "unverified", `${a.name}: ${v.detail}`);
  }

  // A new login: from env (both modes) or from the prompts.
  let fields: { account: string; host: string; port: string; user: string; pass: string } | undefined;
  const env = (k: string) => d.env[`HUB_MAIL_${k}`]?.trim();
  if (env("HOST") || env("USER") || env("ACCOUNT")) {
    const pass = fromEnv(d, "HUB_MAIL_PASS");
    const missing = ["ACCOUNT", "HOST", "USER"].filter((k) => !env(k)).map((k) => `HUB_MAIL_${k}`);
    if (!pass) missing.push("HUB_MAIL_PASS (or _FILE)");
    if (missing.length) return res("invalid", `incomplete mail login in the environment, missing: ${missing.join(", ")}`);
    fields = { account: env("ACCOUNT")!, host: env("HOST")!, port: env("PORT") ?? "993", user: env("USER")!, pass: pass! };
  } else if (!o.nonInteractive) {
    const more = accounts.length
      ? ask(await d.ui.confirm(`Mail logins found: ${accounts.map((a) => a.name).join(", ")}. Add another?`, false))
      : ask(await d.ui.choose("Mail login: set it up now?", [{ value: "yes", label: "Yes (read-only IMAP, app password)" }, { value: "no", label: "Skip (optional, run setup again any time)" }])) === "yes";
    if (more) {
      d.ui.note("The agent reads history over IMAP, read only: it can list and fetch, never send, flag or delete.\nUse an app password (Gmail: Google Account > Security > App passwords), not your normal password.\nIt is stored in state/secrets/mail-<name>.json, mode 600.", "Mail login");
      const account = ask(await d.ui.text("Account name (the name a project lists under mail.accounts)", { initial: "Mail" })).trim();
      const host = ask(await d.ui.text("IMAP host", { initial: "imap.gmail.com" })).trim();
      const port = ask(await d.ui.text("IMAP port", { initial: "993" })).trim();
      const user = ask(await d.ui.text("Login (e-mail address)")).trim();
      const pass = ask(await d.ui.password("App password (hidden; empty = later)")).trim();
      if (account && host && user && pass) fields = { account, host, port, user, pass };
      else note("skipped", "left for later");
    } else if (!accounts.length) return res("skipped", "optional, skipped");
  }

  if (fields) {
    try {
      const acc = parseAccount(JSON.stringify({ ...fields, port: Number(fields.port) }));
      const v = await d.validators.imap(acc);
      const target = path.join(ctx.configDir, mailFileOf(fields.account));
      if (v.state === "invalid") note("invalid", `${fields.account}: ${v.detail}; nothing stored`);
      else if (existsSync(target)) note("invalid", `${path.basename(target)} already exists; setup never overwrites a login (remove or edit it yourself)`);
      else {
        if (!ctx.dryRun) storeMailLogin(ctx.configDir, { account: fields.account, host: fields.host, port: Number(fields.port), user: fields.user, password: fields.pass }, { replace: false });
        note(v.state === "valid" ? "stored" : "unverified", `${fields.account}: ${v.detail}${v.state === "valid" ? "" : " (stored, not verified)"}; ${path.basename(target)}`);
      }
    } catch (e) {
      note("invalid", `mail login: ${redact(ctx.configDir, e instanceof Error ? e.message : String(e))}`);
    }
  }
  if (!lines.length) return res("skipped", "optional, skipped");
  return res(worst, lines.join("; "));
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
  const { ui } = d;
  try {
    ui.intro(`Hub Workflow setup${o.automation ? " + automation" : " (manual sessions, no tokens)"}${ctx.dryRun ? " (dry run: nothing is written)" : ""}${o.nonInteractive ? " (non-interactive)" : ""}`);

    // 1. Private folder.
    if (!ctx.dryRun) {
      mkdirSync(ctx.configDir, { recursive: true, mode: 0o700 });
      chmodSync(ctx.configDir, 0o700);
    }
    ui.info(`${ctx.dryRun ? "would use" : "using"} ${ctx.configDir} (mode 700)`);

    // 2-4. Automation only: tokens in the order the owner asked: Notion, Telegram; then mail.
    if (o.automation) {
      for (const s of specs(d)) {
        const r = await tokenStage(ctx, d, o, s);
        stages.push(r);
        ui.info(`${s.title}: ${r.status}. ${redact(ctx.configDir, r.detail)}`);
      }
      const mail = await mailStage(ctx, d, o);
      stages.push(mail);
      ui.info(`${mail.title}: ${mail.status}. ${redact(ctx.configDir, mail.detail)}`);
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
  const missing = stages.filter((s) => s.required && (s.status === "missing" || s.status === "invalid"));
  if (o.nonInteractive && missing.length) {
    ui.outro(`Failed. Fix and rerun:\n${missing.map((s) => `- ${s.id}: ${s.detail}`).join("\n")}`);
    return { stages, reports, ownerOnly, exitCode: 1 };
  }
  const failedSteps = reports.some((r) => r.outcome === "failed");
  if (!o.automation) ui.outro(failedSteps ? "Setup left items open: `hub doctor` names them, each with its fix." : "ready: run hub agent");
  else ui.outro(missing.length ? "Setup paused: rerun `pnpm hub setup --automation` to finish." : "Setup finished. `pnpm hub doctor --automation` shows the table any time.");
  return { stages, reports, ownerOnly, exitCode: missing.length || failedSteps ? 1 : 0 };
}
