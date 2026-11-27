import type { WatchConfig, WatchDirectionConfig } from "@hub/watch/config";
import { lensDataFile, lensFile, loadLensFull, redeclareLens, stampOf, type LoadedLens } from "@hub/watch/lens";
import type { WatchStore } from "@hub/watch/store";
import type { WatchAnalysis } from "@hub/watch/reader";
import type { Source } from "./reload";

export interface WatchDirection {
  config: WatchDirectionConfig;
  lens: LoadedLens | null;
  source: Source;
  notice: string | null;
}

interface Ready {
  config: WatchConfig;
  lens: LoadedLens;
  store: WatchStore;
  directions?: WatchDirection[];
}

/** Invalid extra lenses park their own direction; the legacy watcher keeps its last valid configuration. */
export async function loadDirections(packages: string, config: WatchConfig, previous: WatchDirection[] = []): Promise<WatchDirection[]> {
  const result: WatchDirection[] = [];
  for (const next of config.directions ?? []) {
    const prior = previous.find((d) => d.config.id === next.id && d.config.lens === next.lens);
    const dataStamp = stampOf(lensDataFile(packages, next.lens));
    const codeStamp = stampOf(lensFile(packages, next.lens));
    if (!prior || (!prior.lens && (prior.source.dataStamp !== dataStamp || prior.source.codeStamp !== codeStamp))) {
      const loaded = await loadLensFull(packages, next.lens);
      result.push(loaded.ok ? { config: next, lens: loaded.lens,
        source: { module: loaded.module, watchStamp: 0, dataStamp: loaded.dataStamp, codeStamp: loaded.codeStamp }, notice: null }
        : { config: next, lens: null, source: { module: null, watchStamp: 0, dataStamp, codeStamp }, notice: loaded.reason });
      continue;
    }
    const current: WatchDirection = { ...prior, config: next, source: { ...prior.source } };
    if (current.source.module && current.source.dataStamp !== dataStamp) {
      current.source.dataStamp = dataStamp;
      const loaded = redeclareLens(current.source.module, packages, next.lens);
      if (loaded.ok) { current.lens = loaded.lens; current.notice = null; }
      else current.notice = `${loaded.reason}. The last valid lens is kept.`;
    }
    if (current.source.codeStamp !== codeStamp && !current.notice) current.notice = "The lens code changed: restart the server to load it. The running lens is kept.";
    result.push(current);
  }
  return result;
}

export function analysisScopes(p: Ready): WatchAnalysis[] {
  if (!p.config.on) return [];
  return [{ direction: "default", groups: p.config.groups, lens: p.lens, store: p.store, analysisMinutes: p.config.analysisMinutes ?? 360 },
    ...(p.directions ?? []).flatMap((d) => d.config.on && d.lens ? [{ direction: d.config.id, groups: d.config.groups, lens: d.lens, store: p.store.forDirection(d.config.id), analysisMinutes: d.config.analysisMinutes ?? 360 }] : [])];
}

export type Selection =
  | { ok: true; id: string; on: boolean; groups: string[]; lens: LoadedLens; store: WatchStore; notice: string | null; analysisMinutes: number }
  | { ok: false; state: "unknown" | "lens"; reason: string };

/** The caller validates this before reading context or returning a selected direction. */
export function selectDirection(p: Ready, id = "default"): Selection {
  if (id === "default") return { ok: true, id, on: p.config.on, groups: p.config.groups, lens: p.lens, store: p.store.forGroups(p.config.groups), notice: null, analysisMinutes: p.config.analysisMinutes ?? 360 };
  const d = p.directions?.find((x) => x.config.id === id);
  if (!d) return { ok: false, state: "unknown", reason: "Unknown watch direction." };
  if (!d.lens) return { ok: false, state: "lens", reason: d.notice ?? "The direction's lens did not load." };
  return { ok: true, id, on: p.config.on && d.config.on, groups: d.config.groups, lens: d.lens, store: p.store.forDirection(id).forGroups(d.config.groups), notice: d.notice, analysisMinutes: d.config.analysisMinutes ?? 360 };
}

export const directionInfo = (p: Ready) => [
  { id: "default", title: p.lens.title, lens: p.config.lens, enabled: p.config.on, state: "ready" as const, reason: null },
  ...(p.directions ?? []).map((d) => ({ id: d.config.id, title: d.config.title ?? d.lens?.title ?? d.config.id,
    lens: d.config.lens, enabled: p.config.on && d.config.on, state: d.lens ? "ready" as const : "lens" as const, reason: d.notice })),
];
