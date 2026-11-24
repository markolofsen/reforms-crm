import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

// P137 L5 (verdict 6): after the run's flows, this worker's stack's whole log folder (the ops log and the session log, plain
// and gzipped) holds no token shape, and the ops log no seeded client address, no full address and no body (the session log keeps
// the owner's prompts and the agent's tool inputs, P54, and is held to its own rules in `packages/log/test`).
// Named `zz-` so it runs after the flows of its worker. The redactor is `@hub/log/ops` `redactOps`; the same scan over lines the
// real writer wrote is `packages/log/test/log-privacy.test.ts` (`@hub/log/leak-scan`, the patterns kept equal by review).

const SEEDED = ["marta@example.net", "pedro@example.org", "sofia@example.com", "luis@example.net", "ines@example.org"];
const ADDRESS = /\b[A-Za-z0-9._%+-]{2,}@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
const TOKEN = /\b(?:sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{20,}|ntn_[A-Za-z0-9]{6,}|secret_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|\d{5,}:[A-Za-z0-9_-]{20,})\b/g;
const BODY = /"(?:text|body|content|html|plain|message_?text|caption|snippet|excerpt|quote)":"(?!\[body omitted\])[^"]/;

function files(dir: string, top = true): string[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) return top ? files(f, false) : [];
    return /\.jsonl(\.gz)?$/.test(n) ? [f] : [];
  });
}

test("the run's logs keep no client address, body or token", () => {
  const home = process.env.HUB_E2E_HOME;
  test.skip(!home, "no e2e stack home");
  const dir = path.join(home ?? "", "state", "log");
  const leaks: string[] = [];
  for (const f of files(dir)) {
    const text = f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8");
    const ops = path.basename(f).startsWith("ops-") && path.dirname(f) === dir;
    text.split("\n").forEach((l, i) => {
      const at = `${path.relative(dir, f)}:${i + 1}`;
      if (ops) for (const a of SEEDED) if (l.includes(a)) leaks.push(`${at} a seeded address`);
      if (TOKEN.test(l)) leaks.push(`${at} a token shape`);
      TOKEN.lastIndex = 0;
      if (ops && (l.match(ADDRESS) ?? []).length) leaks.push(`${at} a full address`);
      if (ops && BODY.test(l)) leaks.push(`${at} a body field`);
    });
  }
  expect(leaks).toEqual([]);
});
