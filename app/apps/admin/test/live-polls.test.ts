import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// State rule 13 (P126 S1): live updates come from the stream. The pulse polls only while the stream is down, and a batch
// run's progress is the one screen poll; the autolink's memory and the WhatsApp pairing are bumped by the server's watches.

const src = path.resolve(import.meta.dirname, "../src");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

describe("polls", () => {
  it("only the pulse and the batch run set a refetchInterval", () => {
    const files = walk(src).filter((f) => /\.tsx?$/.test(f) && /refetchInterval/.test(readFileSync(f, "utf8"))).map((f) => path.relative(src, f)).sort();
    expect(files).toEqual(["lib/cache/pulse.ts", "lib/data/drafts.ts"]);
  });
});
