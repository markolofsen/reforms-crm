import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// P137 L4: a log day file is plain for its first two days, then gzipped (`retention.ts`). Both logs' readers read either.

/** A day file's text, plain or gzipped. Throws as `readFileSync` does. */
export function readDayFile(file: string): string {
  const buf = readFileSync(file);
  return file.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}
