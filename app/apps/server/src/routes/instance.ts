import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Hono } from "hono";
import { hubPaths, instanceBrand, type HubPaths } from "@hub/config/paths";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { CheckTooSoon, type CoreUpdatesService } from "../core-updates";
import { notFound } from "../http";

/** The image types a logo may be; anything else is not served. */
const LOGO_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * The instance's brand (P48 W0): `name` and whether a logo exists, then the logo itself. The config is read per request,
 * so an edit shows on reload. The browser never learns the logo's path. Read only. `localOpen` (P61): whether the server can run
 * the Open actions on this machine; the admin renders no Open button when it is false.
 */
export function instanceRoutes(paths?: Pick<HubPaths, "configFile" | "configDir">, localOpen: () => boolean = () => false) {
  const brand = () => instanceBrand(paths ?? hubPaths());
  return new Hono()
    .get("/api/instance", (c) => {
      const b = brand();
      return c.json(instanceDto.parse({ name: b.name, hasLogo: b.logoFound && extname(b.logo ?? "").toLowerCase() in LOGO_TYPES, localOpen: localOpen() }));
    })
    .get("/api/instance/logo", (c) => {
      const b = brand();
      const type = b.logo ? LOGO_TYPES[extname(b.logo).toLowerCase()] : undefined;
      if (!b.logo || !b.logoFound || !type) return notFound(c, "logo");
      let body: Buffer;
      try {
        body = readFileSync(b.logo);
      } catch {
        return notFound(c, "logo");
      }
      // An SVG may carry script: served with a CSP that runs none, and never sniffed as anything else.
      return c.body(new Uint8Array(body), 200, { "content-type": type, "cache-control": "no-cache", "x-content-type-options": "nosniff", ...(type === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}) });
    });
}

/**
 * P68: `GET /api/instance/core` is the cached answer of the core update check (never a git call: the timer and "Check now" make
 * them); `POST /api/instance/core/check` runs one check now, 429 within a minute of the last. The check only reads the origin
 * and fetches tags into the core, so the loopback guard of the whole API is its door. Without the service both are 404.
 */
export function coreRoutes(service: CoreUpdatesService | undefined) {
  return new Hono()
    .get("/api/instance/core", (c) => {
      if (!service) return notFound(c, "core update check");
      return c.json(coreUpdateDto.parse(service.read()));
    })
    .post("/api/instance/core/check", async (c) => {
      if (!service) return notFound(c, "core update check");
      try {
        return c.json(coreUpdateDto.parse(await service.check()));
      } catch (e) {
        if (e instanceof CheckTooSoon) return c.json({ error: e.message, code: "wrong_state" as const }, 429, { "retry-after": String(e.retryAfterS) });
        throw e;
      }
    });
}
