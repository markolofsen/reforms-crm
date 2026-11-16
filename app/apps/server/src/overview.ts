import type { Repos } from "@hub/db";
import type { HealthDto } from "@hub/contract/health";
import { overviewDto, refreshResponse, type LiveSource, type MailboxDto, type NotionDto, type OverviewDto, type ProjectCardDto, type RefreshRequest, type RefreshResponse } from "@hub/contract/overview";
import { attentionOf, verdictOf, type ProjectExtra } from "./overview-attention";
import { gatherFacts, hostTimeZone, type ProjectFacts } from "./overview-facts";
import type { LiveReads } from "./overview-live";

/**
 * The Overview of every project (P31). `GET` assembles it from SQLite, the project folders and the live cache; it makes no
 * network call. `refresh` is the one way a Mail or Notion number is read, and it reads only (IMAP search and headers,
 * Notion queries). Nothing here writes to the database.
 */
export interface OverviewService {
  get(): Promise<OverviewDto>;
  /** Null when the project is not registered or is archived. */
  refresh(req: RefreshRequest): Promise<RefreshResponse | null>;
}

export interface OverviewOptions {
  repos: Repos;
  projectsDir: string;
  live: LiveReads;
  health: () => HealthDto;
  dataVersion: () => number;
  now: () => Date;
  timeZone?: string;
}

type Block = { state: string; asOf?: string };

/** The oldest read time among the live numbers shown, or null when none has one. */
export function oldestAsOf(cards: ProjectCardDto[]): string | null {
  const blocks: Block[] = cards.flatMap((c) => [...c.mailboxes.map((m) => m.newSinceTriage), ...[c.notion.clients, c.notion.leads].flatMap((s) => (s ? [s.count] : []))]);
  const stamps = blocks.flatMap((b) => (b.asOf ? [b.asOf] : []));
  return stamps.length === 0 ? null : stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

export function createOverview(o: OverviewOptions): OverviewService {
  const zone = o.timeZone ?? hostTimeZone();

  async function facts(): Promise<ProjectFacts[]> {
    const { projects } = await o.repos.projects.registry();
    return gatherFacts({ repos: o.repos, root: o.projectsDir, now: o.now(), hostZone: zone, rows: projects });
  }

  async function cardOf(f: ProjectFacts, sharedAccounts: Set<string>): Promise<ProjectCardDto> {
    const slug = f.card.slug;
    const have = await o.live.logins(slug);
    const mailboxes: MailboxDto[] = f.accounts.map((account) => ({ account, shared: sharedAccounts.has(account.toLowerCase()), newSinceTriage: o.live.mailBlock(slug, account, have.has(account.toLowerCase())) }));
    const { tokenFile } = f.plan.notion;
    const hasToken = f.notionIds.clients !== null || f.notionIds.leads !== null ? await o.live.tokenPresent(tokenFile) : true;
    const source = (name: "clients" | "leads"): NonNullable<NotionDto["clients"]> | null => {
      const id = f.notionIds[name];
      return id === null ? null : { dataSourceId: id, count: o.live.notionBlock(slug, name, tokenFile, hasToken) };
    };
    return { ...f.card, mailboxes, notion: { clients: source("clients"), leads: source("leads") } };
  }

  async function snapshot(all: ProjectFacts[]) {
    const owners = new Map<string, number>();
    for (const f of all) for (const a of new Set(f.accounts.map((x) => x.toLowerCase()))) owners.set(a, (owners.get(a) ?? 0) + 1);
    const shared = new Set([...owners].filter(([, n]) => n > 1).map(([a]) => a));
    const cards = await Promise.all(all.map((f) => cardOf(f, shared)));
    const extra: Record<string, ProjectExtra> = Object.fromEntries(all.map((f) => [f.card.slug, f.extra]));
    const attention = attentionOf({ now: o.now(), cards, extra, system: o.health() });
    return { cards, attention, verdict: verdictOf(attention), oldest: oldestAsOf(cards) };
  }

  return {
    async get() {
      const s = await snapshot(await facts());
      return overviewDto.parse({
        serverTime: o.now().toISOString(),
        timeZone: zone,
        dataVersion: o.dataVersion(),
        oldestAsOf: s.oldest,
        verdict: s.verdict,
        attention: s.attention,
        projects: s.cards,
        system: o.health(),
      });
    },

    async refresh(req) {
      const all = await facts();
      const f = all.find((x) => x.card.slug === req.project);
      if (!f || f.card.archived || f.card.status === "archived") return null;
      const sources: LiveSource[] = [...new Set(req.sources)];
      const outcomes = await o.live.refresh({ ...f.plan, sources });
      const s = await snapshot(all);
      const project = s.cards.find((c) => c.slug === req.project);
      if (!project) return null;
      return refreshResponse.parse({ outcomes, project, attention: s.attention, verdict: s.verdict, oldestAsOf: s.oldest });
    },
  };
}
