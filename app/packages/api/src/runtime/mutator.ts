import { parseApiError, type ApiErrorCode } from "@hub/contract/errors";

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

type GeneratedEnvelope = { data: unknown; status: number; headers: Headers };

/** Orval's fetch client expects the response envelope so `readGenerated` can enforce status and Zod shape. */
export async function hubMutator<T extends GeneratedEnvelope>(url: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: "same-origin" });
  } catch {
    throw new HubApiError("Cannot reach the local server. Is it running? Start it with `hub up`.", "server", 0);
  }

  if (response.status === 503) {
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
