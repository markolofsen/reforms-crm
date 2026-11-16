import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with sorted keys, 2-space indent and a trailing newline: the same value always gives the same bytes. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * Notion signs hosted-file URLs and they expire within the hour. Keeping the signature would change the dump on every
 * run, so a hosted file keeps its URL without the query string and loses `expiry_time`.
 */
export function stripSignedFileUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSignedFileUrls);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(src)) {
      if (key === "file" && src.type === "file" && child && typeof child === "object") {
        const file = child as Record<string, unknown>;
        out[key] = typeof file.url === "string" ? { url: file.url.split("?")[0] } : stripSignedFileUrls(child);
      } else {
        out[key] = stripSignedFileUrls(child);
      }
    }
    return out;
  }
  return value;
}

export function normalizePage<T>(page: T): T {
  return stripSignedFileUrls(page) as T;
}
