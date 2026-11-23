import { ALLOWED_HOSTNAMES } from "@hub/config";
import { NextResponse, type NextRequest } from "next/server";
import { NO_PROJECT, PROJECTLESS_PATHS, SCOPED_HEADS } from "./routes/table";

// The Host and Origin guard of apps/server/src/app.ts, again, in front of the pages AND the `/api` rewrite. Next sets the
// upstream Host to the destination, so Hono alone never sees a foreign Host once the rewrite is in between (P32 N0).
// With a `src/` directory this file must be `src/proxy.ts`; at the app root Next ignores it silently.
// It also serves a bare scoped address (P127 A2, one route tree): `/mail` has no page of its own, the page is
// `(shell)/[project]/mail`, so `/mail` is rewritten (never redirected: the address bar keeps `/mail`) to `/_/mail`, where
// `_` (`NO_PROJECT`) is the `[project]` of an address that names none. The shell then picks the project as before.

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  // The project is in the path (P48), so nothing is added here: the shell frame writes the canonical address.
  const bare = bareScoped(request.nextUrl.pathname);
  if (bare === null) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = bare;
  return NextResponse.rewrite(url);
}

/** The inside address of a bare scoped one (`/mail/c/42` → `/_/mail/c/42`), or null: a projectless page, `/`, `/api`, a project's address. */
export function bareScoped(pathname: string): string | null {
  const head = pathname.split("/")[1] ?? "";
  if (!SCOPED_HEADS.has(head) || PROJECTLESS_PATHS.has(pathname)) return null;
  return `/${NO_PROJECT}${pathname}`;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
