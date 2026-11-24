import { existsSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { join } from "node:path";

// P140 K1: the running server reindexes a project's knowledge when a file under `<projects>/<slug>/knowledge/` changes, so an
// edit by the owner or an attended session shows in `knowledge_search` with no `hub knowledge index` run. Debounced per project:
// a burst of writes (an import, a session editing several entries) is one reindex.

export interface KnowledgeWatchOptions {
  /** The projects folder. */
  root: string;
  /** The projects to follow (read when the watch starts). */
  slugs: readonly string[];
  /** Reindexes one project; a failure is the caller's to log. Never awaited twice for one project at once. */
  reindex: (slug: string) => Promise<void>;
  debounceMs?: number;
  /** Injected in tests; default `fs.watch` (recursive: FSEvents on macOS). */
  watch?: (dir: string, onChange: () => void) => { close(): void };
}

const defaultWatch = (dir: string, onChange: () => void): FSWatcher => {
  const w = fsWatch(dir, { recursive: true, persistent: false }, (_event, name) => {
    if (!name || String(name).endsWith(".md")) onChange();
  });
  w.on("error", () => undefined);
  return w;
};

/** Starts one watcher per project that has a `knowledge/` folder. `stop()` closes them and drops pending reindexes. */
export function watchKnowledge(o: KnowledgeWatchOptions): { stop(): void; /** Pending projects, for tests. */ pending(): string[] } {
  const debounceMs = o.debounceMs ?? 1000;
  const watch = o.watch ?? defaultWatch;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const run = (slug: string): void => {
    if (running.has(slug)) {
      again.add(slug);
      return;
    }
    const p = o.reindex(slug).catch(() => undefined).finally(() => {
      running.delete(slug);
      if (again.delete(slug)) run(slug);
    });
    running.set(slug, p);
  };
  const changed = (slug: string) => {
    const t = timers.get(slug);
    if (t) clearTimeout(t);
    const next = setTimeout(() => {
      timers.delete(slug);
      run(slug);
    }, debounceMs);
    next.unref?.();
    timers.set(slug, next);
  };
  const handles = o.slugs.flatMap((slug) => {
    const dir = join(o.root, slug, "knowledge");
    if (!existsSync(dir)) return [];
    try {
      return [watch(dir, () => changed(slug))];
    } catch {
      return [];
    }
  });
  return {
    stop() {
      for (const h of handles) h.close();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    pending: () => [...timers.keys()],
  };
}
