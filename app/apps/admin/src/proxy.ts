import { ALLOWED_HOSTNAMES } from "@hub/config";
import { NextResponse, type NextRequest } from "next/server";

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

export function proxy(request: NextRequest) {
  if (!allowed(hostnameOf(request.headers.get("host") ?? ""))) return forbidden("forbidden host");
  const origin = request.headers.get("origin");
  if (origin !== null && MUTATING.has(request.method) && !originAllowed(origin)) return forbidden("forbidden origin");
  // The project is in the path (P48), so nothing is added here: the shell frame writes the canonical address.
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
