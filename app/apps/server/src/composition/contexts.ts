import { API_VERSION, healthDto } from "@hub/contract/health";
import { instanceLlm } from "@hub/config/llm";
import { hubPaths } from "@hub/config/paths";
import { capSentence, hasKey, llmFake, noKeySentence } from "@hub/llm";
import { NO_APPS } from "@hub/contract/local";
import type { Runtime } from "./runtime";
import type { MailContext } from "../mail/context";
import type { SendContext } from "../send/context";
import type { MessengersContext, MessengerDirectory } from "../messengers/context";
import type { ProjectsContext } from "../projects/context";
import type { AgentContext } from "../agent/context";
import type { InstanceContext } from "../instance/context";
import type { OverviewContext } from "../overview/context";
import type { LiveContext } from "../live/context";
import type { TerminalContext } from "../terminal/context";
import type { LocalContext } from "../local/context";
import { INBOUND_OFF } from "../mail/inbound";
import { SENT_OFF } from "../mail/sent";
import { OFF } from "../messengers/bot";
import { TELEGRAM_USER_OFF } from "../messengers/accounts/telegram-user";
import { WHATSAPP_OFF } from "../messengers/accounts/whatsapp";
import { createOverview } from "../overview/overview";
import { STUCK_MINUTES } from "../overview/facts";
import type { SchemeSources } from "../overview/scheme";
import { projectDoctor } from "../projects/doctor";
import { projectOverview } from "../projects/overview";

/** How long the Overview's parts wait for Mail's account list before saying "not checked here" (the read goes on and fills the cache). */
const SCHEME_MAIL_MS = 400;

export type Contexts = {
  overview: OverviewContext;
  live: LiveContext;
  projects: ProjectsContext;
  instance: InstanceContext;
  mail: MailContext;
  send: SendContext;
  agent: AgentContext;
  terminal: TerminalContext;
  local: LocalContext;
  messengers: MessengersContext;
};

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

/** One context per domain, cut from the runtime once (P126 S1, P120 W4); a route module reads only its own. */
export function contexts(rt: Runtime): Contexts {
  const { repos, now, adminPort, projects, projectsDir } = rt;
  const health = () =>
    healthDto.parse({
      ok: true,
      apiVersion: API_VERSION,
      messengers: (rt.messengers.bot ?? (() => OFF))(),
      telegramUser: rt.messengers.telegramUser?.status() ?? TELEGRAM_USER_OFF,
      whatsapp: rt.messengers.whatsapp?.status() ?? WHATSAPP_OFF,
      sent: (rt.mail.sent ?? (() => SENT_OFF))(),
      inbound: rt.mail.inbound?.status() ?? INBOUND_OFF,
      mailer: rt.mail.sender?.kind ?? "mail-app",
    });
  const overview = rt.overview?.service ?? createOverview({ repos, projects, health, dataVersion: rt.dataVersion, now, ...optional("timeZone", rt.timeZone) });
  const tools = rt.agent.tools;
  const scheme: SchemeSources = {
    projects: async () => (await repos.projects.registry()).projects.filter((p) => !p.archived).map((p) => p.slug),
    doctor: (slug) => projectDoctor(repos, slug, projectsDir, process.env, rt.policyDir),
    files: (slug) => projectOverview(repos, slug, projectsDir),
    agentTools: (slug) => tools?.peek(slug) ?? null,
    connections: () => rt.instance.connections.list({ mailWithinMs: SCHEME_MAIL_MS }),
    health,
    stopped: (slug) => repos.sends.isStopped(slug),
    sendTrouble: async (slug) => {
      const t = now().getTime();
      const day = new Date(t - 24 * 3_600_000).toISOString();
      const s = await repos.sends.summarySince(slug, { today: day, day, stuckBefore: new Date(t - STUCK_MINUTES * 60_000).toISOString() });
      return { failed: s.failed, stuck: s.stuck };
    },
    // P133 (P129 verdict 11): the refusals of hub mcp only the owner can fix, the last 24 hours.
    ownerFixes: (slug) => repos.ownerFixes.active(slug, now()),
    clis: () => tools?.clis() ?? null,
    core: () => rt.instance.core?.read() ?? null,
    // P78: read per request (the key and config.json may change while the server runs); the key's value is dropped in hasKey.
    llm: async () => ({ month: await repos.llmCalls.month(now()), capMicroUsd: instanceLlm(hubPaths()).capMicroUsd, keyPresent: hasKey(), fake: llmFake(), noKeyFix: noKeySentence(), capFix: capSentence }),
    ...rt.overview?.scheme,
  };
  const al = rt.messengers.autolink;
  const directory: MessengerDirectory | undefined = al ? { project: al.project, directory: al.directory, identityOf: al.autolink.identityOf } : undefined;
  const sender = rt.mail.sender;
  const local = rt.instance.local;
  return {
    overview: { health, dataVersion: rt.dataVersion, now, overview, scheme },
    live: optional("live", rt.live),
    projects: { repos, root: projectsDir, projects, now, ...optional("policyDir", rt.policyDir), ...optional("timeZone", rt.timeZone), ...optional("links", rt.projectLinks?.reader ? { reader: rt.projectLinks.reader } : undefined), ...optional("followUps", rt.followUps), ...optional("leadPass", rt.leadPass), adminPort },
    instance: {
      now,
      adminPort,
      connections: rt.instance.connections,
      localOpen: () => local?.available ?? false,
      apps: () => local?.apps?.status() ?? NO_APPS,
      ...optional("paths", rt.instance.paths),
      ...optional("core", rt.instance.core),
      ...optional("autostart", rt.instance.autostart),
      ...optional("opsLog", rt.instance.opsLog),
    },
    mail: {
      repos,
      projects,
      ...optional("sender", sender),
      ...optional("reader", rt.mail.inbound),
      ...optional("readText", rt.mail.inboundText),
      ...optional("leads", rt.mail.leads),
      ...optional("mail", rt.mail.conversation),
      ...optional("sentPass", rt.mail.sentPass),
      ...optional("refillWhatsApp", rt.messengers.whatsapp?.refill.bind(rt.messengers.whatsapp)),
      ...optional("directory", directory),
    },
    send: { repos, ...optional("sender", sender), ...optional("messengers", rt.messengers.senders), ...optional("leads", rt.mail.leads) },
    agent: { repos, now, adminPort, ...optional("tools", tools), ...optional("focus", rt.agent.focus), ...optional("pointerFile", rt.agent.pointerFile), ...optional("log", rt.agent.log) },
    terminal: { adminPort, ...optional("terminal", rt.terminal) },
    local: { adminPort, ...optional("local", local) },
    messengers: {
      repos,
      adminPort,
      now,
      ...optional("preanalysis", rt.messengers.preanalysis),
      ...optional("reply", rt.messengers.reply ? { llm: rt.messengers.reply.llm, projectsDir, ...optional("policyDir", rt.policyDir) } : undefined),
      ...optional("directory", directory),
      ...optional("tg", rt.messengers.telegramUser),
      ...optional("wa", rt.messengers.whatsapp),
      ...optional("autolink", al),
      ...optional("agentToken", sender?.agent?.token),
      ...optional("autopilot", rt.messengers.autopilot),
    },
  };
}
