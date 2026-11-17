import { ALLOWED_HOSTNAMES } from "@hub/config";
import { NextResponse, type NextRequest } from "next/server";
import { PROJECT_COOKIE, PROJECT_SCOPED } from "./routes/guards";

// The Host and Origin guard of apps/server/src/app.ts, again, in front of the pages AND the `/api` rewrite. Next sets the
// upstream Host to the destination, so Hono alone never sees a foreign Host once the rewrite is in between (P32 N0).
// With a `src/` directory this file must be `src/proxy.ts`; at the app root Next ignores it silently.

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

/**
 * A bare project-scoped address (`/drafts`, `/bulk/3`) gets the remembered project before the page renders: the address
 * always names the project (`routes-and-url-state.md` rule 10). Overview and `/` carry none. A cookie that names a project that
 * no longer exists costs one more rewrite: the shell frame checks it against the registry (the page has no server fetch).
 */
function withProject(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  if (request.method !== "GET" || !PROJECT_SCOPED.test(pathname) || searchParams.has("project")) return null;
  const project = request.cookies.get(PROJECT_COOKIE)?.value;
  if (!project || project.length > 120) return null;
  const url = request.nextUrl.clone();
  url.search = new URLSearchParams([["project", project], ...searchParams]).toString();
  return NextResponse.redirect(url);
}

export function proxy(request: NextRequest) {
  if (!allowed(hostnameOf(request.headers.get("host") ?? ""))) return forbidden("forbidden host");
  const origin = request.headers.get("origin");
  if (origin !== null && MUTATING.has(request.method) && !originAllowed(origin)) return forbidden("forbidden origin");
  return withProject(request) ?? NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
