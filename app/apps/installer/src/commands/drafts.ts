import path from "node:path";
import { auditRun, evidenceTable } from "../audit-run";
import { batchCheck, batchLines } from "../batch-check";
import { runPolicyCommand } from "../send/policy-command";
import { runSendCommand } from "../send/command";
import { stampSentMail } from "@hub/notion/stamp";
import type { SentNotice } from "@hub/send";
import { runDraftsSweep } from "../drafts/sweep-command";
import { ctxOf, projectsDir, ledgerRoot, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the draft and send commands: send, drafts, audit-run, batch-check. */
export function register(program: Command): void {
  program.command("send").argument("[draftId]", "the draft to send, or `policy` (see below)").argument("[policyArgs...]", "`hub send policy [<slug>] | set <slug> <field> <value> ... | migrate [<slug>]`: the send policy, written only here").description("Send an accepted draft from Mail (dry run unless --apply); --due runs the autosend queue (off unless a project's send policy says send.mode auto); --cancel/--stop/--resume/--status; `policy` shows or sets the send policy. Only a person or this command sends: the agent has no send tool.")
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

  program.command("drafts").argument("<action>", "`sweep`: the Hub's own leftover drafts in Mail (older versions, closed drafts) to Trash").description("Mail drafts the Hub wrote (P56, P65). `hub drafts sweep` lists the versions the Hub recorded that are left over (dry run); --apply moves them to each account's Trash, recoverable. A draft the Hub did not record is the owner's and is never listed. Nothing is sent.")
    .option("--project <slug>", "one project (default: every project of the instance)")
    .option("--apply", "move the listed drafts to Trash (default: dry run, nothing changes)")
    .action(async (action: string, o: { project?: string; apply?: boolean }) => {
      const env = { projectsDir: projectsDir(), policyDir: ctxOf().paths.stateProjects };
      if (action === "sweep") return done(await runDraftsSweep(o, env));
      console.log(JSON.stringify({ ok: false, error: `unknown action ${action}: the action is sweep` }));
      return done(2);
    });

  program.command("audit-run").description("Audit of one finished session: did any tool call leave the project (foreign mail account, foreign knowledge project, another project's folder, a send-capable tool)? And a table of the evidence behind every reply (messages read, profile, facts, anchors, similarity); exit 1 on a breach or a red row. Read only.")
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
      if (r.evidence.length) {
        console.log(`\nevidence behind ${r.evidence.length} repl${r.evidence.length === 1 ? "y" : "ies"}:`);
        for (const l of evidenceTable(r.evidence)) console.log(l);
        if (r.evidence.some((x) => x.verdict === "red")) { console.log("RED: at least one reply was written without the thread or profile read, or copies another."); process.exitCode = 1; }
      }
    });

  program.command("batch-check").description("One batch of drafts as a set: evidence per client, the closest pairs, counts; exit 1 on a red row. Reads state/evidence (works with the server off).")
    .requiredOption("--project <slug>", "the project")
    .requiredOption("--batch <key>", "the batchKey every draft_write record of the run passed")
    .option("--json", "machine-readable output")
    .action((o: { project: string; batch: string; json?: boolean }) => {
      const r = batchCheck(ledgerRoot(), o.project, o.batch);
      if (!r.rows.length) { console.log(o.json ? JSON.stringify({ ok: false, error: `no drafts recorded with batchKey ${o.batch} in ${o.project}` }) : `no drafts recorded with batchKey ${o.batch} in ${o.project}`); return done(2); }
      if (o.json) console.log(JSON.stringify(r)); else for (const l of batchLines(r)) console.log(l);
      done(r.red ? 1 : 0);
    });
}
