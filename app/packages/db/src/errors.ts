export type RepoErrorCode =
  | "unknown_project"
  | "empty_query"
  | "duplicate_claim"
  | "not_found"
  | "duplicate_identifier"
  | "wrong_state"
  | "invalid";

/** A repository refusal with a stable `code` the callers (CLI, MCP tool) can map without parsing a message. */
export class RepoError extends Error {
  constructor(
    readonly code: RepoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepoError";
  }
}
