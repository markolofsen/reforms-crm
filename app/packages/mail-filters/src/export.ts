// Exporters. (a) Gmail `mailFilters.xml` import file (Atom, apps:property entries): the main path, no OAuth.
// (b) A Gmail API request list (labels.create, filters.create) as JSON: generated only, never sent by this code.
import { buildFilters, type FilterSpec } from "./filters.js";
import { checkRules } from "./safety.js";
import { hasErrors, formatIssue, type RulesFile } from "./model.js";

export class UnsafeRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeRulesError";
  }
}

function assertSafe(file: RulesFile): void {
  const issues = checkRules(file).filter((i) => i.severity === "error");
  if (hasErrors(issues)) throw new UnsafeRulesError(`refusing to export, the rules file fails the safety check:\n${issues.map(formatIssue).join("\n")}`);
}

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");

/** `now` is injected so the output is reproducible (golden files). */
export function exportXml(file: RulesFile, opts: { slug: string; now: string }): string {
  assertSafe(file);
  const specs = buildFilters(file);
  const prop = (name: string, value: string) => `\t\t<apps:property name='${name}' value='${xml(value)}'/>`;
  const entries = specs.map((s, i) =>
    [
      "\t<entry>",
      "\t\t<category term='filter'></category>",
      "\t\t<title>Mail Filter</title>",
      `\t\t<id>tag:mail.google.com,2008:filter:hub-${i + 1}</id>`,
      `\t\t<updated>${opts.now}</updated>`,
      "\t\t<content></content>",
      ...(s.criteria.from ? [prop("from", s.criteria.from)] : []),
      ...(s.criteria.subject ? [prop("subject", s.criteria.subject)] : []),
      ...(s.criteria.hasTheWord ? [prop("hasTheWord", s.criteria.hasTheWord)] : []),
      prop("label", s.label),
      ...(s.archive ? [prop("shouldArchive", "true")] : []),
      ...(s.markRead ? [prop("shouldMarkAsRead", "true")] : []),
      ...(s.neverSpam ? [prop("shouldNeverSpam", "true")] : []),
      prop("sizeOperator", "s_sl"),
      prop("sizeUnit", "s_smb"),
      "\t</entry>",
    ].join("\n"),
  );
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    "<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>",
    "\t<title>Mail Filters</title>",
    `\t<id>tag:mail.google.com,2008:filters:hub-${xml(opts.slug)}</id>`,
    `\t<updated>${opts.now}</updated>`,
    "\t<author><name>Hub Workflow</name></author>",
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}

export interface ApiRequest {
  id: string;
  /** Gmail API method name, for humans. */
  method: "labels.create" | "filters.create";
  httpMethod: "POST";
  path: string;
  body: unknown;
}

export interface ApiExport {
  version: 1;
  project: string;
  note: string;
  requests: ApiRequest[];
}

const labelRef = (name: string) => `{{label:${name}}}`;

function filterBody(s: FilterSpec) {
  return {
    criteria: s.criteria.hasTheWord ? { query: s.criteria.hasTheWord } : s.criteria.from ? { from: s.criteria.from } : { subject: s.criteria.subject },
    action: {
      addLabelIds: [labelRef(s.label)],
      // `INBOX` removal is "skip inbox", `UNREAD` removal is "mark as read". Nothing else is ever removed or added.
      ...(s.archive || s.markRead ? { removeLabelIds: [...(s.archive ? ["INBOX"] : []), ...(s.markRead ? ["UNREAD"] : [])] } : {}),
    },
  };
}

export function exportApi(file: RulesFile, opts: { slug: string }): ApiExport {
  assertSafe(file);
  const specs = buildFilters(file);
  const names = new Set<string>();
  for (const s of specs) {
    const parts = s.label.split("/");
    for (let i = 1; i <= parts.length; i++) names.add(parts.slice(0, i).join("/"));
  }
  const labels: ApiRequest[] = [...names].sort().map((name) => ({
    id: `label:${name}`,
    method: "labels.create",
    httpMethod: "POST",
    path: "/gmail/v1/users/me/labels",
    body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  }));
  const filters: ApiRequest[] = specs.map((s, i) => ({
    id: `filter:${i + 1}`,
    method: "filters.create",
    httpMethod: "POST",
    path: "/gmail/v1/users/me/settings/filters",
    body: filterBody(s),
  }));
  return {
    version: 1,
    project: opts.slug,
    note: "Generated only; Hub code never sends it. Create the labels first (an existing label answers 409: read its id with labels.list), then replace every {{label:NAME}} with that label's id.",
    requests: [...labels, ...filters],
  };
}
