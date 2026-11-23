// The issues a project.md read reports, and the error that carries them.
import { HubError } from "@hub/config/errors";

export type IssueCode =
  | "bad_slug"
  | "unknown_schema"
  | "schema_required"
  | "missing_required"
  | "bad_date"
  | "bad_value"
  | "bad_table"
  | "bad_by"
  | "unknown_field"
  | "duplicate_row"
  | "stray_list_item"
  | "bad_database_id"
  | "duplicate_database"
  | "bad_link"
  | "send_policy_in_project_md";

export interface Issue {
  severity: "error" | "warning";
  code: IssueCode;
  /** 1-based line in project.md, when the issue has one. */
  line: number | null;
  field?: string;
  message: string;
}

export const formatIssue = (i: Issue): string =>
  `${i.severity}: ${i.code}${i.line ? ` (line ${i.line})` : ""}${i.field ? ` [${i.field}]` : ""}: ${i.message}`;

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === "error");

export class ProjectError extends HubError {
  constructor(readonly issues: Issue[]) {
    super("invalid", "invalid_project", issues.filter((i) => i.severity === "error").map(formatIssue).join("\n") || "invalid project.md");
    this.name = "ProjectError";
  }
}
