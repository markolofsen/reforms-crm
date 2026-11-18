import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Hono } from "hono";
import { hubPaths, instanceBrand, type HubPaths } from "@hub/config/paths";
import { instanceDto } from "@hub/contract/instance";
import { notFound } from "../http";

/** The image types a logo may be; anything else is not served. */
const LOGO_TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * The instance's brand (P48 W0): `name` and whether a logo exists, then the logo itself. The config is read per request,
 * so an edit shows on reload. The browser never learns the logo's path. Read only.
 */
export function instanceRoutes(paths?: Pick<HubPaths, "configFile" | "configDir">) {
  const brand = () => instanceBrand(paths ?? hubPaths());
  return new Hono()
    .get("/api/instance", (c) => {
      const b = brand();
      return c.json(instanceDto.parse({ name: b.name, hasLogo: b.logoFound && extname(b.logo ?? "").toLowerCase() in LOGO_TYPES }));
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
