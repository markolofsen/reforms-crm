import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// P147 3j (5): a dock session keeps the `hub mcp` process it started with. After the Hub is updated (a new core, or a dev checkout
// edited), that process still serves the old tools and their old schemas, and the agent then reads skills that name arguments its
// tools do not take. The process stamps its own tool sources at start; once a source is newer, every call answers `core_changed`
// ("the Hub was updated: start a new dock session") instead of failing on a schema the skill no longer matches.

const MCP_DIR = dirname(fileURLToPath(import.meta.url));

/** The newest modification time (ms) of the tool sources: `mcp/*.ts` and `mcp/tools/*.ts`; 0 when none can be read. */
export function toolsStamp(dir: string = MCP_DIR): number {
  let newest = 0;
  for (const d of [dir, join(dir, "tools")]) {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".ts") && !n.endsWith(".js")) continue;
      try {
        newest = Math.max(newest, statSync(join(d, n)).mtimeMs);
      } catch {
        /* a file removed while read: the others decide */
      }
    }
  }
  return newest;
}

/** Whether the tool sources changed since `start` (asked per call, read at most every `everyMs`). */
export function coreChangedSince(start: number, read: () => number = toolsStamp, everyMs = 2000, now: () => number = Date.now): () => boolean {
  let at = 0;
  let changed = false;
  return () => {
    if (changed || start === 0) return changed;
    if (now() - at < everyMs) return false;
    at = now();
    changed = read() > start;
    return changed;
  };
}
