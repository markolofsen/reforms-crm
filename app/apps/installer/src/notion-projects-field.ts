import { matchProjectKeys, projectKey } from "@hub/projects/brands";
import type { Ctx } from "./context";
import { notionTokenOf, optionsOf, patchDataSource, readDataSource, type LiveOption, type LiveProperty } from "./notion-api";
import type { NotionProject } from "./notion-check";

// P145 K3 (verdict 6, decision 0053): one project key per `## Brands` row, carried as an option of Clients `Projects` (and of
// `Projects` on Documents, Contacts, Tasks, Expenses and Bug reports) and of Leads `Brand`. The installer adds an option where no
// option has the brand's key, and creates Clients `Projects` (multi_select) when it is missing; it never removes or renames an
// option. An option no brand row claims (another project's brand, or a project with no brand row, such as a development) is
// reported, never deleted. `Project signals` is a cross-database formula the API cannot create: the doctor warns when it is missing.

/** The databases whose project property the step keeps in step with `## Brands`, and the property's name in each. */
export const PROJECT_PROPERTIES: ReadonlyArray<{ database: string; property: "Projects" | "Brand"; create: boolean }> = [
  { database: "clients", property: "Projects", create: true },
  { database: "leads", property: "Brand", create: false },
  { database: "documents", property: "Projects", create: false },
  { database: "business-contacts", property: "Projects", create: false },
  { database: "tasks", property: "Projects", create: false },
  { database: "expenses", property: "Projects", create: false },
  { database: "bug-reports", property: "Projects", create: true },
];
export const PROJECT_SIGNALS = "Project signals";
const PROJECTS_DESCRIPTION = "The projects this client is confirmed for (one option per project key; decision 0053). Added by the agent and people on evidence, never removed by the Hub.";

export type KeyProject = NotionProject & { parsed: { config: { brands: ReadonlyArray<{ name: string }> } } };

export interface ProjectFieldRow {
  slug: string;
  database: string;
  property: string;
  dataSourceId: string;
  token: string;
  state: "ok" | "missing" | "no_property" | "wrong_type" | "no_token" | "error";
  /** Brand names to add as options (no option has their key). */
  add: string[];
  /** The options as Notion holds them: sent back unchanged with the new ones. */
  options: LiveOption[];
  /** Brand -> the options its key matched (one is right). */
  pairs: Array<{ brand: string; key: string; matched: string[] }>;
  /** Options no brand row claims (never deleted). */
  unclaimed: string[];
  /** Clients only: whether `Project signals` exists. */
  signals?: boolean;
  detail: string;
}

/** What one live property needs: the brands with no option of their key. Pure. */
export function projectFieldPlan(brands: ReadonlyArray<{ name: string }>, live: LiveProperty | undefined): Pick<ProjectFieldRow, "add" | "options" | "pairs" | "unclaimed"> {
  const options = optionsOf(live);
  const names = options.map((o) => o.name ?? "").filter(Boolean);
  const { rows, unclaimed } = matchProjectKeys(brands, names);
  const add = rows.filter((r) => r.key && r.matched.length === 0).map((r) => r.brand);
  return { add: [...new Map(add.map((b) => [projectKey(b), b])).values()], options, pairs: rows, unclaimed };
}

/** The PATCH body: the options Notion holds (ids kept) plus the new names; a missing Clients `Projects` is created. Pure. */
export function projectFieldPatch(r: Pick<ProjectFieldRow, "property" | "state" | "add" | "options">): Record<string, unknown> {
  const kept = r.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), ...(o.name ? { name: o.name } : {}), ...(o.color ? { color: o.color } : {}) }));
  const options = [...kept, ...r.add.map((name) => ({ name }))];
  return { [r.property]: r.state === "no_property" ? { multi_select: { options }, description: PROJECTS_DESCRIPTION } : { multi_select: { options } } };
}

const pairText = (r: ProjectFieldRow) => r.pairs.map((p) => `${p.brand}->${p.key}->${p.matched.length ? p.matched.join("+") : "none"}`).join(", ");

/** Where each listed database stands. Read only: one GET per database the table names. */
export async function projectFieldRows(ctx: Ctx, projects: readonly KeyProject[]): Promise<ProjectFieldRow[]> {
  const rows: ProjectFieldRow[] = [];
  for (const p of projects) {
    const brands = p.parsed.config.brands;
    if (!brands.length) continue;
    const token = notionTokenOf(ctx, p.parsed.config.notion.tokenFile);
    for (const want of PROJECT_PROPERTIES) {
      const ds = p.parsed.config.notion.databases.find((d) => d.slug === want.database)?.dataSourceId;
      if (!ds) continue;
      const base = { slug: p.slug, database: want.database, property: want.property, dataSourceId: ds, token, add: [], options: [], pairs: [], unclaimed: [] };
      const where = `${p.slug} ${want.database}.${want.property}`;
      if (!token) {
        rows.push({ ...base, state: "no_token", detail: `${p.slug}: no ${p.parsed.config.notion.tokenFile} to read ${want.database} with` });
        continue;
      }
      try {
        const r = await readDataSource(ctx, token, ds);
        if (!r.ok) {
          rows.push({ ...base, state: "error", detail: `${p.slug}: Notion answered ${r.status} for ${want.database} (see notion.access)` });
          continue;
        }
        const live = r.body.properties?.[want.property];
        const signals = want.database === "clients" ? r.body.properties?.[PROJECT_SIGNALS]?.type === "formula" : undefined;
        const extra = signals === undefined ? {} : { signals };
        if (!live) {
          const plan = projectFieldPlan(brands, undefined);
          rows.push({ ...base, ...plan, ...extra, state: want.create ? "no_property" : "wrong_type", detail: want.create ? `${where}: missing (would be created with ${plan.add.length} option(s))` : `${where}: missing: add a multi_select "${want.property}" in Notion (or rename the old one)` });
          continue;
        }
        if (live.type !== "multi_select") {
          rows.push({ ...base, ...extra, state: "wrong_type", detail: `${where} is a ${live.type}, not a multi_select: change it in Notion` });
          continue;
        }
        const plan = projectFieldPlan(brands, live);
        const row: ProjectFieldRow = { ...base, ...plan, ...extra, state: plan.add.length ? "missing" : "ok", detail: "" };
        row.detail = `${where}: ${pairText(row)}${plan.add.length ? `; to add: ${plan.add.join(", ")}` : ""}${plan.unclaimed.length ? `; no brand row: ${plan.unclaimed.join(", ")}` : ""}`;
        rows.push(row);
      } catch (e) {
        rows.push({ ...base, state: "error", detail: `${p.slug}: cannot reach Notion (${(e as Error).name})` });
      }
    }
  }
  return rows;
}

/** Adds the missing options (and a missing Clients or Bug reports `Projects`); returns what it did. Never removes an option. */
export async function addProjectOptions(ctx: Ctx, rows: readonly ProjectFieldRow[]): Promise<string> {
  const done: string[] = [];
  for (const r of rows.filter((x) => x.state === "missing" || x.state === "no_property")) {
    await patchDataSource(ctx, r.token, r.dataSourceId, projectFieldPatch(r), `${r.slug} ${r.database}.${r.property}`);
    done.push(`${r.slug} ${r.database}.${r.property} (${r.state === "no_property" ? "created, " : ""}${r.add.length ? `+${r.add.join(", +")}` : "no option"})`);
  }
  return done.length ? `added ${done.join("; ")}` : "nothing to add";
}

/** The doctor's reading of the rows (`notion.project-keys`): every brand matches one option; an unclaimed option or a missing formula warns. */
export function projectKeyVerdict(rows: readonly ProjectFieldRow[]): { level: "pass" | "warn" | "fail"; detail: string } {
  if (!rows.length) return { level: "pass", detail: "no project lists ## Brands and a Notion database with a project property" };
  const drift = rows.filter((r) => r.state === "missing" || r.state === "no_property" || r.pairs.some((p) => p.matched.length > 1));
  const warns = rows.filter((r) => r.state === "wrong_type" || r.state === "no_token" || r.state === "error" || r.unclaimed.length || r.signals === false);
  const lines = rows.map((r) => `${r.detail}${r.signals === false ? `; no "${PROJECT_SIGNALS}" formula (the pack's text: notion-crm/schema/clients.json)` : ""}`);
  if (drift.length) return { level: "fail", detail: `${lines.join(" | ")}: \`hub install --only notion.projects\` adds the missing options; two options with one key are merged by hand in Notion` };
  return { level: warns.length ? "warn" : "pass", detail: lines.join(" | ") };
}
