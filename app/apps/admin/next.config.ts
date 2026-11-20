import type { NextConfig } from "next";
import { HOST, SERVER_PORT } from "@hub/config";

// The API stays the Hono server (decision 0015): the browser calls `/api/*` on this origin and Next forwards it.
const API = `http://${HOST}:${process.env.HUB_PORT ?? SERVER_PORT}`;

// Live-edit loop (`pnpm live`): the worktree borrows the main checkout's install through symlinks, and Turbopack follows
// them only when its root is a common ancestor of both (P32 N0, research 19 section 6).
const root = process.env.HUB_NEXT_ROOT;

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
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default config;
