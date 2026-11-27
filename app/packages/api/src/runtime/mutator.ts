import { parseApiError, type ApiErrorCode } from "@hub/contract/errors";
import { ACTION_HEADER, newActionId } from "@hub/config/action-id";

export class HubApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly refused: string[];

  constructor(message: string, code: ApiErrorCode, status: number, refused: string[] = []) {
    super(message);
    this.name = "HubApiError";
    this.code = code;
    this.status = status;
    this.refused = refused;
  }
}

const BUSY_RETRY_MS = 400;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * P137 L1: a write is the owner's action; it names itself (`x-hub-action`), so the server's lines, the session it may start and
 * the Notion and Mail writes it makes carry one id. Writes are never replayed here. A read carries none: the server gives it one.
 */
function withAction(options: RequestInit): RequestInit {
  const method = (options.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return options;
  const headers = new Headers(options.headers);
  if (!headers.has(ACTION_HEADER)) headers.set(ACTION_HEADER, newActionId("w"));
  return { ...options, headers };
}

type GeneratedEnvelope = { data: unknown; status: number; headers: Headers };

/** Orval's fetch client expects the response envelope so `readGenerated` can enforce status and Zod shape. */
export async function hubMutator<T extends GeneratedEnvelope>(url: string, options: RequestInit): Promise<T> {
  options = withAction(options);
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: "same-origin" });
  } catch {
    throw new HubApiError("Cannot reach the local server. Is it running? Start it with `hub up`.", "server", 0);
  }

  const method = (options.method ?? "GET").toUpperCase();
  if (response.status === 503 && (method === "GET" || method === "HEAD")) {
    await wait(BUSY_RETRY_MS);
    try {
      response = await fetch(url, { ...options, credentials: "same-origin" });
    } catch {
      throw new HubApiError("Cannot reach the local server. Is it running? Start it with `hub up`.", "server", 0);
    }
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = parseApiError(body, response.status);
    throw new HubApiError(error.error, error.code, response.status, error.refused ?? []);
  }
  return { data: body, status: response.status, headers: response.headers } as T;
}

type ParsedResponse = { data: unknown; status: number };
type Parser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

export function parseHubResponse<T>(response: ParsedResponse, parser: Parser<T>, expected: readonly number[] = [200]): T {
  if (!expected.includes(response.status)) throw new HubApiError("The server answered with an unexpected status.", "server", response.status);
  const parsed = parser.safeParse(response.data);
  if (!parsed.success) throw new HubApiError("The server answered in a shape this page does not know. Restart the server with `hub up`.", "server", response.status);
  return parsed.data;
}
