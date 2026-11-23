import { HubError, type ErrorKind } from "@hub/config/errors";
export type RepoErrorCode =
  | "unknown_project"
  | "empty_query"
  | "duplicate_claim"
  | "not_found"
  | "duplicate_identifier"
  | "wrong_state"
  | "invalid";

/** The kind of each code (P126 E1): the server answers a repo refusal with the kind's status, never by hand per route. */
const REPO_KINDS: Readonly<Record<RepoErrorCode, ErrorKind>> = {
  unknown_project: "wrong_state",
  empty_query: "wrong_state",
  duplicate_claim: "wrong_state",
  not_found: "not_found",
  duplicate_identifier: "wrong_state",
  wrong_state: "wrong_state",
  invalid: "wrong_state",
};

/** A repository refusal with a stable `code` the callers (CLI, MCP tool) can map without parsing a message. */
export class RepoError extends HubError {
  declare readonly code: RepoErrorCode;
  constructor(code: RepoErrorCode, message: string) {
    super(REPO_KINDS[code], code, message);
    this.name = "RepoError";
  }
}
