import type { QueryKey } from "@tanstack/react-query";
import type { LiveTopic } from "@hub/contract/live";

/**
 * The one query-key factory (`state-and-data.md` rule 2). A key names the resource first, then the project, then every
 * input that changes the reply, so a prefix (`["drafts", project]`) matches every view of one project's drafts.
 */
export const keys = {
  pulse: () => ["pulse"] as const,
  instance: () => ["instance"] as const,
  projects: () => ["projects"] as const,
  overview: () => ["overview"] as const,
  connections: () => ["connections"] as const,
  /** P67: the instance's LaunchAgent (Connections, "This Mac"). */
  autostart: () => ["autostart"] as const,
  /** P68: the core update check (the sidebar's version line and the block on /health). */
  core: () => ["core"] as const,
  agentTools: (project: string) => ["agent-tools", project] as const,
  /** The agent activity feed (P59): the last rows of the session log, read on the server. */
  agentFeed: (project: string) => ["agent-feed", project] as const,
  drafts: (project: string, view: string, batch: number | null, search: string) => ["drafts", project, view, batch, search] as const,
  batches: (project: string) => ["batches", project] as const,
  notByEmail: (project: string, kind: string | null) => ["not-by-email", project, kind] as const,
  enrollments: (project: string, view: string) => ["enrollments", project, view] as const,
  activity: (project: string, filter: string) => ["activity", project, filter] as const,
  timeline: (project: string, clientId: number) => ["timeline", project, clientId] as const,
  project: (project: string) => ["project", project] as const,
  rules: (project: string) => ["rules", project] as const,
  sends: (project: string) => ["sends", project] as const,
  doctor: (project: string) => ["doctor", project] as const,
  /** Reads of Mail (an `osascript` call each): the draft as Mail holds it, and a client's thread. */
  draftMail: (project: string, id: number) => ["draft-mail", project, id] as const,
  thread: (project: string, clientId: number) => ["thread", project, clientId] as const,
};

/**
 * The first part of the Mail keys: read on open and on focus (decision 0013). The one live event that reads Mail again is
 * `mail` (P53): the hub itself wrote a Mail draft of that project (`draft_write`), so the open card shows the new text.
 */
export const MAIL_KEYS: readonly string[] = ["draft-mail", "thread"];

/** One project's prefix of a resource, or every project's when the change is the instance's (`null`). */
const of = (resource: string) => (project: string | null): QueryKey => (project === null ? [resource] : [resource, project]);
const drafts = of("drafts");
const batches = of("batches");
const notByEmail = of("not-by-email");
const enrollments = of("enrollments");
const activity = of("activity");
const timeline = of("timeline");
const project = of("project");
const rules = of("rules");
const sends = of("sends");
const agentTools = of("agent-tools");
const agentFeed = of("agent-feed");
const overview = () => keys.overview();
const draftMail = of("draft-mail");
const thread = of("thread");

/**
 * What each live topic invalidates (P50). `tsc` fails when a topic is added without its keys. Only `mail` names a Mail key
 * (each read is an osascript call, so a row change never triggers one), and the doctor is read on open only: its checks are
 * not cheap and not rows.
 */
export const TOPIC_KEYS: Record<LiveTopic, (project: string | null) => QueryKey[]> = {
  drafts: (p) => [drafts(p), batches(p), timeline(p), project(p), overview()],
  clients: (p) => [drafts(p), notByEmail(p), enrollments(p), timeline(p), overview()],
  activity: (p) => [activity(p), timeline(p), project(p), overview()],
  sends: (p) => [sends(p), drafts(p), project(p), overview()],
  inbox: (p) => [notByEmail(p), drafts(p), overview()],
  "follow-ups": (p) => [enrollments(p), drafts(p)],
  batches: (p) => [batches(p), drafts(p)],
  rules: (p) => [rules(p), drafts(p), project(p)],
  projects: (p) => [keys.projects(), project(p), agentTools(p), keys.connections(), overview()],
  knowledge: (p) => [project(p)],
  messengers: (p) => [drafts(p), notByEmail(p), project(p), keys.connections()],
  connections: () => [keys.connections(), agentTools(null), overview()],
  health: (p) => [keys.pulse(), project(p), keys.connections(), overview()],
  mail: (p) => [draftMail(p), thread(p)],
  "agent-log": (p) => [agentFeed(p)],
  autostart: () => [keys.autostart()],
  core: () => [keys.core()],
};
