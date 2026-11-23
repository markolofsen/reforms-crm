import { ALLOWED_HOSTNAMES, HOST } from "@hub/config";
import { NextResponse, type NextRequest } from "next/server";
import { NO_PROJECT, PROJECTLESS_PATHS, SCOPED_HEADS } from "./routes/table";

// The Host and Origin guard of apps/server/src/app.ts, again, in front of the pages AND the `/api` rewrite. Next sets the
// upstream Host to the destination, so Hono alone never sees a foreign Host once the rewrite is in between (P32 N0).
// With a `src/` directory this file must be `src/proxy.ts`; at the app root Next ignores it silently.
// It also serves a bare scoped address (P127 A2, one route tree): `/mail` has no page of its own, the page is
// `(shell)/[project]/mail`, so `/mail` is rewritten (never redirected: the address bar keeps `/mail`) to `/_/mail`, where
// `_` (`NO_PROJECT`) is the `[project]` of an address that names none. The shell then picks the project as before.
// This file decides (`bareScoped`) and marks the request with `BARE_HEADER`; the `beforeFiles` rewrite of `next.config.ts`
// performs it. A rewrite returned from here cannot: Next re-reads its URL as a NextURL, which spells 127.0.0.1 `localhost`, so
// under `next start -H 127.0.0.1` its origin is not the server's own, and Next proxies it as an EXTERNAL rewrite to
// localhost (::1, refused): a 500 on every bare address (found at the P130 gate).

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// P121 T4: the e2e run serves one production build from one `next start` per worker, each with its own API; the build's `/api`
// rewrite names one port, so with `HUB_E2E_RUNTIME_API=1` (set only by `e2e/stacks.ts`) `/api` goes to this process's `HUB_PORT`,
// read at request time. Unset (every instance), the rewrite of `next.config.ts` serves `/api` as before.
const runtimeApi = (): string | null => (process.env.HUB_E2E_RUNTIME_API === "1" && process.env.HUB_PORT ? `http://${HOST}:${process.env.HUB_PORT}` : null);

const allowed = (hostname: string): boolean => ALLOWED_HOSTNAMES.some((h) => h === hostname);

function hostnameOf(value: string): string {
  try {
    return new URL(`http://${value}`).hostname;
  } catch {
    return "";
  }
}

function originAllowed(origin: string): boolean {
  try {
    return allowed(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const forbidden = (error: string) => NextResponse.json({ error, code: "forbidden" }, { status: 403 });

export function proxy(request: NextRequest) {
  if (!allowed(hostnameOf(request.headers.get("host") ?? ""))) return forbidden("forbidden host");
  const origin = request.headers.get("origin");
  if (origin !== null && MUTATING.has(request.method) && !originAllowed(origin)) return forbidden("forbidden origin");
  const api = request.nextUrl.pathname.startsWith("/api/") ? runtimeApi() : null;
  if (api) return NextResponse.rewrite(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, api));
  // The project is in the path (P48), so nothing is added here: the shell frame writes the canonical address.
  const bare = bareScoped(request.nextUrl.pathname) !== null;
  if (!bare && !request.headers.has(BARE_HEADER)) return NextResponse.next();
  // The mark is this file's alone: one sent by the client is dropped, so only a bare scoped address reaches `/_/`.
  const headers = new Headers(request.headers);
  if (bare) headers.set(BARE_HEADER, "1");
  else headers.delete(BARE_HEADER);
  return NextResponse.next({ request: { headers } });
}

/** The request header that marks a bare scoped address; `next.config.ts` rewrites a marked request to `/_<path>`. */
export const BARE_HEADER = "x-hub-bare";

/** The inside address of a bare scoped one (`/mail/c/42` → `/_/mail/c/42`), or null: a projectless page, `/`, `/api`, a project's address. */
export function bareScoped(pathname: string): string | null {
  const head = pathname.split("/")[1] ?? "";
  if (!SCOPED_HEADS.has(head) || PROJECTLESS_PATHS.has(pathname)) return null;
  return `/${NO_PROJECT}${pathname}`;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
