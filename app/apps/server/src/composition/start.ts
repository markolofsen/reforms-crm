import { bumpTopic, createRepos, dataVersion, type Db } from "@hub/db";
import { instancePorts, type HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import { opsSignature, opsStoreOf } from "@hub/log/ops";
import { projectStore } from "@hub/projects/store";
import { readAllowList } from "@hub/projects/guard";
import type { Runtime } from "./runtime";
import { createLive, folderSignature, logSignatures } from "../live/live";
import { projectsRoot } from "../projects/overview";
import { start as startMessengers } from "../messengers/start";
import { openWaAppReader } from "@hub/messengers";
import { autopilotBrainOf } from "../messengers/autopilot/brain";
import { start as startMail } from "../mail/start";
import { start as startTerminal } from "../terminal/start";
import { start as startAgent } from "../agent/start";
import { start as startInstance } from "../instance/start";
import { startKnowledgeIndex } from "../knowledge/start";
import { followUpBrainOf, startFollowUps } from "../follow-ups/start";
import { leadPassBrainOf, startLeadPass } from "../passes/start";
import { messengerPolicy } from "../send/messenger-policy";

/** A started runtime and what only the process needs from it: the terminal's upgrade and one stop for every domain. */
export type Started = { runtime: Runtime; upgrade: ReturnType<typeof startTerminal>["terminal"]["upgrade"]; stop(): Promise<void> };

/**
 * Starts every domain once, in dependency order (P126 S1): messengers (the autolink the Mail reader asks), Mail, the terminal,
 * the agent, the instance, then live panels over all of their signatures.
 */
export async function startRuntime(o: { db: Db; modes: RuntimeModes; paths: HubPaths; apiPort: number }): Promise<Started> {
  const { db, modes, paths } = o;
  const repos = createRepos(db);
  const adminPort = instancePorts(paths).admin;
  const projectsDir = projectsRoot();
  // P126 P3: the one reader of project.md with its send policy; every server module reads a project's config through it.
  const projects = projectStore({ projects: projectsDir, stateProjects: paths.stateProjects });
  // P141 W3: only the real composition reads the owner's WhatsApp app database (read only); tests never pass it.
  // P139 A3: the autopilot's brain is chosen here, once (the real one only for a real instance, never in a test or an e2e run).
  const messengers = await startMessengers({ repos, autopilotFiles: { switchFile: paths.autopilot, policyDir: paths.stateProjects, projectsDir }, autopilotBrain: autopilotBrainOf({ env: process.env, paths, repos }), allowList: readAllowList(paths.configFile), waAppReader: () => openWaAppReader() });
  const linker = messengers.handles.autolink;
  const busy: { now: () => boolean } = { now: () => false };
  const mail = startMail({
    repos,
    paths,
    modes,
    projectsDir,
    projects,
    busy: () => busy.now(),
    mailMoved: (project) => void bumpTopic(db, "mail", project),
    knownClient: (project, email) => linker.project === project && (linker.directory.current()?.all.some((e) => e.email?.trim().toLowerCase() === email) ?? false),
  });
  // P142 (decision 0050): the daily follow-up sweep, the one timer that starts a model; its nudges go through the same door.
  const senders = messengers.handles.senders;
  const doorPolicy = messengerPolicy({ projectsDir, policyDir: paths.stateProjects, allowList: readAllowList(paths.configFile) });
  const followUps = startFollowUps({
    repos,
    projects,
    brain: followUpBrainOf({ env: process.env, paths, repos }),
    autopilot: messengers.handles.autopilot,
    door: () => (senders ? { repos, policy: doorPolicy, senders } : null),
    mail: mail.handles.conversation,
    directory: { get project() { return linker.project; }, all: () => linker.directory.current()?.all },
  });
  // P147 (decision 0055): the daily lead pass, the second timer that starts a model; it writes drafts and proposals only.
  const leadPass = startLeadPass({
    repos,
    projects,
    brain: leadPassBrainOf({ env: process.env, paths, repos }),
    autopilot: messengers.handles.autopilot,
    leads: mail.handles.leads,
    directory: { get project() { return linker.project; }, all: () => linker.directory.current()?.all },
    notion: { projectsDir, secretsDir: paths.secrets },
  });
  const { terminal, detector } = startTerminal({ repos, paths, modes, adminPort, apiPort: o.apiPort });
  const agent = startAgent({ repos, paths, modes, detector, recheck: () => void terminal.recheck() });
  const instance = startInstance({ repos, paths, modes, projects, fakeMail: mail.kind === "fake", bot: messengers.handles.bot });
  // P140 K1: the knowledge index follows the files (a pass now, then a watcher on each project's knowledge/).
  const knowledge = await startKnowledgeIndex({ repos, projectsDir });
  // Live panels (P50): the trigger counter tailed every 200 ms; the pollers' state and the Connections files are watched, since
  // they are not rows (a poll's timestamp is left out, except the Mail reader's: "Mail read 1 min ago" must follow).
  const pollers = () => [...messengers.states(), ...mail.states()].map((s) => `${s.state}|${s.reason ?? ""}|${s.lastError ?? ""}`).join("\n");
  const autostart = instance.handles.autostart;
  const core = instance.handles.core;
  const live = createLive({
    db,
    watch: [
      { topic: "health", signature: pollers, everyMs: 1000 },
      { topic: "connections", signature: () => folderSignature(paths.secrets), everyMs: 1000 },
      { topic: "agent-log", signatures: () => logSignatures(paths.log), everyMs: 500 },
      ...(autostart ? [{ topic: "autostart" as const, signature: autostart.signature, everyMs: 1000 }] : []),
      ...(core ? [{ topic: "core" as const, signature: core.signature, everyMs: 1000 }] : []),
      { topic: "ops-log", signature: () => opsSignature(opsStoreOf(paths)), everyMs: 1000 },
      { topic: "messengers", signatures: () => (linker.project ? { [linker.project]: linker.autolink.signature() } : {}), everyMs: 1000 },
      { topic: "connections", signature: () => messengers.handles.whatsapp.pairing.signature(), everyMs: 1000 },
    ],
  });
  busy.now = () => live.count() > 0 || terminal.state().sessions.length > 0;
  const runtime: Runtime = {
    repos,
    now: () => new Date(),
    adminPort,
    dataVersion: () => dataVersion(db),
    projectsDir,
    policyDir: paths.stateProjects,
    projects,
    followUps,
    leadPass,
    mail: {
      ...mail.handles,
      sender: {
        kind: mail.kind,
        mailer: mail.mailer,
        projectsDir,
        policyDir: paths.stateProjects,
        allowList: readAllowList(paths.configFile),
        adminPort,
        writer: mail.writer,
        mailWritten: (project) => void bumpTopic(db, "mail", project),
        agent: agent.send,
        ...(mail.onSent ? { onSent: mail.onSent } : {}),
      },
    },
    messengers: messengers.handles,
    agent: agent.handles,
    instance: instance.handles,
    live,
    terminal,
  };
  return {
    runtime,
    upgrade: terminal.upgrade,
    stop: async () => {
      await followUps.stop();
      await leadPass.stop();
      live.stop();
      knowledge.stop();
      instance.stop();
      mail.stop();
      terminal.stop();
      await messengers.stop();
    },
  };
}
