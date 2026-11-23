// P126 E1 (verdict 3.6): the one base of every refusal the Hub states, so each surface maps it once: the server's `onError`
// (the kind gives the HTTP status, the body is `@hub/contract/errors`' shape), `hub mcp`'s `run` (a refusal with advice) and
// the `hub` CLI (exit 2). A subclass keeps its own `code` vocabulary and sets `kind` from one table of its codes. It lives
// here, not in `@hub/contract`, because every package already depends on `@hub/config` (db, messengers, notion and knowledge
// do not depend on the contract, and adding the link needs an install in the core that the saas instance runs from).

/** What kind of refusal it is; the HTTP status of each is {@link STATUS_OF}. `upstream`: a service the Hub called failed (502). */
export const ERROR_KINDS = ["invalid", "not_found", "wrong_state", "unavailable", "forbidden", "busy", "upstream"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const STATUS_OF = { invalid: 400, not_found: 404, wrong_state: 409, unavailable: 503, forbidden: 403, busy: 503, upstream: 502 } as const satisfies Record<ErrorKind, number>;

export class HubError extends Error {
  constructor(
    readonly kind: ErrorKind,
    /** The subclass's own code (`RepoError`'s `not_found`, a Mail script's `mail_slow`): what a caller branches on. */
    readonly code: string,
    message: string,
    /** Fields the refusal carries beside its sentence (the server's body, the MCP refusal). */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HubError";
  }
}
