import type { NextConfig } from "next";
import { HOST, SERVER_PORT } from "@hub/config";

// The API stays the Hono server (decision 0015): the browser calls `/api/*` on this origin and Next forwards it.
const API = `http://${HOST}:${process.env.HUB_PORT ?? SERVER_PORT}`;

// Live-edit loop (`pnpm live`): the worktree borrows the main checkout's install through symlinks, and Turbopack follows
// them only when its root is a common ancestor of both (P32 N0, research 19 section 6).
const root = process.env.HUB_NEXT_ROOT;

/** The first segments of the scoped routes (`SCOPED_HEADS` of `src/routes/table.ts`; `test/proxy.test.ts` holds them equal). */
export const BARE_HEADS = "mail|messengers|log|knowledge|settings";

const config: NextConfig = {
  typedRoutes: true,
  // Next writes an AGENTS.md into the app on every start; the repo's rules live in app/@rules.
  agentRules: false,
  poweredByHeader: false,
  // Packages that ship TypeScript source (no build step); @hub/ui also needs its CSS `@source` (packages/ui/src/styles.css).
  transpilePackages: ["@hub/contract", "@hub/config", "@hub/ui"],
  // Dev resources answer loopback names only.
  allowedDevOrigins: [HOST, "localhost"],
  // The e2e run builds into its own directory so it never collides with a running dev server.
  distDir: process.env.HUB_NEXT_DIST ?? ".next",
  ...(root ? { turbopack: { root } } : {}),
  // The slowest server call (Notion plus mail) takes about 40 s; the 30 s default answers 500 "socket hang up".
  // P76: a terminal drop is up to 20 MiB (`DROP_LIMITS`) plus its multipart framing; Next buffers a proxied body up to 10 MiB by default.
  experimental: { proxyTimeout: 120_000, proxyClientMaxBodySize: "21mb" },
  // P127 A2: a bare scoped address (`/mail`) is served from `/_/mail`. `src/proxy.ts` decides and marks the request (`x-hub-bare`,
  // its BARE_HEADER, which it drops when a client sends it); these rules perform the rewrite inside the server. The head is a
  // regex on purpose: typedRoutes skips such a source, so a rewrite never makes a bare literal a page (`test/paths.types.tsx`).
  async rewrites() {
    const marked = [{ type: "header" as const, key: "x-hub-bare", value: "1" }];
    return {
      beforeFiles: [
        { source: `/:head(${BARE_HEADS})`, has: marked, destination: "/_/:head" },
        { source: `/:head(${BARE_HEADS})/:rest*`, has: marked, destination: "/_/:head/:rest*" },
      ],
      afterFiles: [{ source: "/api/:path*", destination: `${API}/api/:path*` }],
      fallback: [],
    };
  },
};

export default config;
