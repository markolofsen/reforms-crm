import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { loadProjects, syncProjects } from "@hub/projects";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const fixtureRoot = join(here, "fixtures", "projects");
export const goldDir = join(here, "fixtures", "gold");

const dirs: string[] = [];
export const cleanup = () => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
export const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "hub-knowledge-"));
  dirs.push(d);
  return d;
};

/** A writable copy of the invented projects. */
export function copyRoot(): string {
  const root = tmp();
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

export async function openRegistered(root: string): Promise<{ handle: DbHandle; repos: Repos }> {
  const handle = openDb(":memory:");
  const repos = createRepos(handle.db);
  const r = await syncProjects(repos, loadProjects(root));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return { handle, repos };
}

// ---- an invented Notion dump of a Knowledge database ---------------------------------------------------------------

type PropSpec = Record<string, unknown>;
const rich = (t: string) => ({ type: "rich_text", rich_text: [{ plain_text: t }] });
const sel = (n: string | null) => ({ type: "select", select: n ? { name: n } : null });
const multi = (ns: string[]) => ({ type: "multi_select", multi_select: ns.map((name) => ({ name })) });
const date = (d: string | null) => ({ type: "date", date: d ? { start: d } : null });

export interface FixturePage {
  id: string;
  title: string;
  body: string;
  props: PropSpec;
}

export const pageProps = (o: {
  title: string;
  approved?: boolean;
  use?: string | null;
  audiences?: string[];
  category?: string;
  kind?: string;
  stages?: string[];
  folder?: string;
  phrasings?: string;
  validUntil?: string;
  lastConfirmed?: string;
  source?: string;
  supersedes?: string;
}): PropSpec => ({
  Question: { type: "title", title: [{ plain_text: o.title }] },
  Approved: { type: "checkbox", checkbox: o.approved ?? false },
  Use: sel(o.use === undefined ? "STATE" : o.use),
  Audiences: multi(o.audiences ?? []),
  Category: sel(o.category ?? null),
  Kind: sel(o.kind ?? null),
  Stages: multi(o.stages ?? []),
  Folder: sel(o.folder ?? null),
  Phrasings: rich(o.phrasings ?? ""),
  "Valid until": date(o.validUntil ?? null),
  "Last confirmed": date(o.lastConfirmed ?? null),
  Source: rich(o.source ?? ""),
  Supersedes: rich(o.supersedes ?? ""),
  "Sync hash": rich("not-mapped"),
});

export const PAGES: FixturePage[] = [
  {
    id: "aaaaaaaa-1111-4111-8111-000000000001",
    title: "Acme passport fee",
    body: "The government fee is 5,000 EUR.\n\n- paid on approval\n- not refundable\n",
    props: pageProps({
      title: "Acme passport fee",
      approved: true,
      audiences: ["CLIENT", "LEAD"],
      category: "FEES",
      kind: "FIGURE",
      stages: ["ENQUIRY", "DISCOVERY"],
      folder: "programmes/grenada",
      phrasings: "how much is the passport | fee for citizenship |  ",
      validUntil: "2099-01-01",
      lastConfirmed: "2026-10-01",
      source: "Gov notice 12",
      supersedes: "old-fee",
    }),
  },
  { id: "bbbbbbbb-2222-4222-8222-000000000002", title: "Unreviewed idea", body: "Not yet approved.\n", props: pageProps({ title: "Unreviewed idea", audiences: ["ANY"] }) },
  { id: "cccccccc-3333-4333-8333-000000000003", title: "Empty use", body: "Use was left blank.\n", props: pageProps({ title: "Empty use", approved: true, use: null, audiences: ["ANY"] }) },
  { id: "dddddddd-4444-4444-8444-000000000004", title: "Old promotion", body: "Ended.\n", props: pageProps({ title: "Old promotion", approved: true, audiences: ["ANY"], validUntil: "2025-01-01", category: "PROMO" }) },
  { id: "eeeeeeee-5555-4555-8555-000000000005", title: "Сроки оформления", body: "Шесть недель.\n\n<!-- notion-dump: truncated unknown_block_ids=x -->\n", props: pageProps({ title: "Сроки оформления", approved: true, audiences: ["CLIENT"], folder: "playbooks/lead", phrasings: "как долго ждать" }) },
];

/** Writes `<root>/<slug>/dumps/<date>/{manifest.json,knowledge/pages/*}` the way @hub/notion's dump does. */
export function writeDump(root: string, slug: string, pages: FixturePage[], date = "2026-11-10"): string {
  const day = join(root, slug, "dumps", date);
  const dir = join(day, "knowledge", "pages");
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    writeFileSync(join(dir, `${p.id}.json`), `${JSON.stringify({ id: p.id, last_edited_time: "2026-11-09T10:00:00.000Z", properties: p.props }, null, 2)}\n`);
    writeFileSync(join(dir, `${p.id}.md`), p.body);
  }
  writeFileSync(join(day, "manifest.json"), `${JSON.stringify({ format: 1, project: slug, date, databases: [{ slug: "knowledge", pages: pages.length }] })}\n`);
  return day;
}
