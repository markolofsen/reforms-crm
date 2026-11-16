// Rule model for per-project Gmail filters. Pure types and constants: no file or network access.

import { KINDS, type Kind } from "@hub/projects";

/** One mail class of a project's kind (`@hub/projects` kinds.ts is the only place that lists them). */
export type MailClass = Kind["mailClasses"][number];
/** The generic kind's set: what a rules file means when nothing else is said. */
export const DEFAULT_CLASSES: readonly MailClass[] = (KINDS.generic as Kind).mailClasses;
/** A class id; which ids exist depends on the project's kind. */
export type Category = string;
export const classIds = (classes: readonly MailClass[]): string[] => classes.map((c) => c.id);
export const classesOf = (f: { classes?: readonly MailClass[] | undefined }): readonly MailClass[] => f.classes ?? DEFAULT_CLASSES;
/** Classes whose mail may leave the inbox. Everything else stays in the inbox, labelled. */
export const skippableIds = (classes: readonly MailClass[]): string[] => classes.filter((c) => c.skippable).map((c) => c.id);
/** Triage reads nothing of mail carrying these labels and reports counts only. */
export const countOnlyIds = (classes: readonly MailClass[]): string[] => classes.filter((c) => c.triage === "count-only").map((c) => c.id);

/** Gmail labels are `hub/<category>[/<sub>]`. */
export const LABEL_PREFIX = "hub";

/** The only two actions that exist. There is no delete, forward, trash or mark-spam action, by construction. */
export const ACTIONS = ["label", "label+skip+read"] as const;
export type Action = (typeof ACTIONS)[number];

export const MATCH_KINDS = ["from", "domain", "list-id", "subject"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface Match {
  kind: MatchKind;
  /** from: normalised address; domain: bare domain; list-id: the id without brackets; subject: a plain phrase. */
  value: string;
}

export type By = "agent" | "owner";

export interface Rule {
  match: Match;
  category: Category;
  label: string;
  action: Action;
  why: string;
  /** ISO date. */
  date: string;
  by: By;
}

/** A client or partner address or domain that must always reach the inbox. */
export interface WhitelistEntry {
  match: Match & { kind: "from" | "domain" };
  why: string;
  date: string;
  by: By;
}

export interface RulesFile {
  rules: Rule[];
  whitelist: WhitelistEntry[];
  /** Free prose after `## Notes`, kept verbatim. */
  notes: string;
  /** Optional per-class color overrides (`## Label colors`): class -> Gmail palette color name. */
  colors?: Partial<Record<Category, string>>;
  /** The mail classes of the project's kind; absent means the generic set. Set by the loader, never written to the file. */
  classes?: readonly MailClass[];
}

export const defaultLabel = (c: Category): string => `${LABEL_PREFIX}/${c}`;

export const matchText = (m: Match): string => (m.kind === "subject" ? `subject:${m.value}` : `${m.kind}:${m.value}`);

export const emptyRulesFile = (classes?: readonly MailClass[]): RulesFile => ({ rules: [], whitelist: [], notes: "", ...(classes ? { classes } : {}) });

export type IssueCode =
  | "bad_match"
  | "bad_category"
  | "bad_label"
  | "bad_action"
  | "forbidden_action"
  | "bad_date"
  | "bad_by"
  | "criteria_too_long"
  | "bad_criteria"
  | "skip_not_allowed"
  | "skip_on_subject"
  | "whitelist_conflict"
  | "duplicate_match"
  | "too_many_filters"
  | "bad_table"
  | "bad_whitelist"
  | "bad_color_class"
  | "bad_color";

export interface Issue {
  severity: "error" | "warning";
  code: IssueCode;
  /** 1-based line in the rules file, when known. */
  line: number | null;
  message: string;
}

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === "error");
export const formatIssue = (i: Issue): string => `${i.severity}: ${i.code}${i.line ? ` (line ${i.line})` : ""}: ${i.message}`;
