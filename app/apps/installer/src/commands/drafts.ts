import path from "node:path";
import { auditRun } from "../audit-run";
import { runPolicyCommand } from "../send/policy-command";
import { runSendCommand } from "../send/command";
import { stampSentMail } from "@hub/notion/stamp";
import type { SentNotice } from "@hub/send/assess";
import { runDraftsSweep } from "../drafts/sweep-command";
import { runHealBrands } from "../drafts/heal-brands-command";
import { logStoreOf } from "@hub/log/store";
import { ctxOf, projectsDir, done } from "./shared";
import type { Command } from "commander";
import { parseClientKey } from "@hub/contract/client-key";
import { createRepos, openDbReadOnly } from "@hub/db";

/** P126 C1: the draft and send commands: send, drafts, audit-run. */
export function register(program: Command): void {
  program.command("send").argument("[draftId]", "the draft to send, or `policy` (see below)").argument("[policyArgs...]", "`hub send policy [<slug>] | set <slug> <field> <value> ... | migrate [<slug>] | autopilot <slug> [mode|chat|disclose ...]`: the send policy and its autopilot block, written only here").description("Send an accepted draft from Mail (dry run unless --apply); --due runs the autosend queue (off unless a project's send policy says send.mode auto); --cancel/--stop/--resume/--status; `policy` shows or sets the send policy. Only a person or this command sends: the agent has no send tool.")
    .option("--dry-run", "`policy migrate`: show what would move")
    .option("--apply", "really send (default: dry run, nothing leaves)")
    .option("--due", "autosend runner: queue eligible drafts of send.classes, send those whose cancel window is over")
    .option("--project <slug>", "limit --due, --stop, --resume, --status to one project")
    .option("--cancel <sendId>", "cancel a queued send inside its window")
    .option("--stop", "Stop all: cancel queued sends and refuse new ones (one project with --project)")
    .option("--resume", "lift Stop all")
    .option("--status", "show Stop all and the queued sends (the last sends with --project)")
    .action(async (draftId: string | undefined, policyArgs: string[], o: { apply?: boolean; due?: boolean; project?: string; cancel?: string; stop?: boolean; resume?: boolean; status?: boolean; dryRun?: boolean }) => {
      if (draftId === "policy") return done(runPolicyCommand([...policyArgs, ...(o.dryRun ? ["--dry-run"] : [])], { projectsDir: projectsDir(), policyDir: ctxOf().paths.stateProjects }));
      if (policyArgs.length) { console.log(JSON.stringify({ ok: false, error: `unexpected arguments: ${policyArgs.join(" ")}` })); return done(2); }
      const { dryRun: _d, ...opts } = o;
      o = opts;
      const num = (v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : NaN);
      const id = num(draftId);
      const cancel = num(o.cancel);
      if (Number.isNaN(id) || Number.isNaN(cancel)) { console.log(JSON.stringify({ ok: false, error: "draftId and --cancel take a number" })); return done(2); }
      const { cancel: _c, ...rest } = o;
      const paths = ctxOf().paths;
      // P89: a send from this terminal stamps the client's Notion page too (Last sent at / by); a failure is an ops-log line only.
      const onSent = async (n: SentNotice) => { await stampSentMail({ projectsDir: paths.projects, secretsDir: paths.secrets, stateDir: paths.state }, n); };
      done(await runSendCommand({ ...rest, ...(id !== undefined ? { draftId: id } : {}), ...(cancel !== undefined ? { cancel } : {}) }, { projectsDir: projectsDir(), policyDir: paths.stateProjects, configFile: paths.configFile, onSent }));
    });

  program.command("drafts").argument("<action>", "`sweep`: the Hub's own leftover drafts in Mail (older versions, closed drafts) to Trash; `heal-brands`: adopted records' brand from the answered message's headers").description("Mail drafts the Hub wrote (P56, P65). `hub drafts sweep` lists the versions the Hub recorded that are left over (dry run); --apply moves them to each account's Trash, recoverable. A draft the Hub did not record is the owner's and is never listed. `hub drafts heal-brands` (P140 R4) lists the records that adopted a saved version and whose brand or address the client wrote to differs from the answered message's headers (dry run); --apply writes the headers' brand and reads it back. Nothing is sent.")
    .option("--project <slug>", "one project (default: every project of the instance)")
    .option("--apply", "move the listed drafts to Trash (default: dry run, nothing changes)")
    .action(async (action: string, o: { project?: string; apply?: boolean }) => {
      const env = { projectsDir: projectsDir(), policyDir: ctxOf().paths.stateProjects };
      if (action === "sweep") return done(await runDraftsSweep(o, env));
      if (action === "heal-brands") return done(await runHealBrands(o, { ...env, log: logStoreOf(ctxOf().paths) }));
      console.log(JSON.stringify({ ok: false, error: `unknown action ${action}: the action is sweep or heal-brands` }));
      return done(2);
    });

  // P135 verdict 8: the client's map as the Hub holds it (the Mermaid source), for a terminal or a session. Read only.
  program.command("client").argument("<action>", "`map`: print the client's map").argument("<key>", "the client's address, or id-<n>").description("A client of one project as the Hub holds it. `hub client map <address> --project <slug>` prints the client's map (the Mermaid text the agent last drew, P135), or says there is none. Read only.")
    .requiredOption("--project <slug>", "the project the client belongs to")
    .option("--previous", "print the version before the current one")
    .action(async (action: string, key: string, o: { project: string; previous?: boolean }) => {
      if (action !== "map") { console.log(JSON.stringify({ ok: false, error: `unknown action ${action}: the action is map` })); return done(2); }
      const ref = parseClientKey(key);
      if (!ref) { console.log(JSON.stringify({ ok: false, error: `${key} is no client key: an address or id-<n>` })); return done(2); }
      const handle = openDbReadOnly(ctxOf().paths.db);
      try {
        const repos = createRepos(handle.db);
        const id = "id" in ref ? ref.id : await repos.clients.findByIdentity(o.project, "email", ref.email);
        const m = id === undefined ? null : await repos.clientMaps.get(o.project, id);
        if (!m) { console.log(`no client ${key} in project ${o.project}`); return done(1); }
        const text = o.previous ? m.previous?.source : m.source;
        if (!text) { console.log(o.previous ? `${m.name} has no previous map` : `${m.name} has no map yet: the agent draws one with the next reply`); return done(0); }
        console.log(`%% ${m.name}, ${o.previous ? `previous, drawn ${m.previous?.at ?? ""}` : `updated ${m.updatedAt ?? ""}`} (${m.versions} version(s))`);
        process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
        return done(0);
      } finally {
        handle.close();
      }
    });

  program.command("audit-run").description("Audit of one finished session: did any tool call leave the project (foreign mail account, foreign knowledge project, another project's folder, a send-capable tool)? Exit 1 on a breach. Read only.")
    .argument("<log>", "a Claude Code session transcript (.jsonl), a `claude -p --output-format stream-json` log, or a session folder (its subagents/*.jsonl are read too)")
    .requiredOption("--project <slug>", "the project the session was bound to")
    .action((log: string, o: { project: string }) => {
      const r = auditRun(path.resolve(log), o.project);
      if (!r.violations.length) console.log(`clean: ${r.calls} tool call(s), none left project ${r.project}`);
      else {
        console.log(`BREACH: ${r.violations.length} of ${r.calls} tool call(s) left project ${r.project}`);
        for (const v of r.violations) console.log(`- ${v}`);
        process.exitCode = 1;
      }
    });
}
