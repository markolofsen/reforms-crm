import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLlm, fakeTransport, memoryLedger, type ChatRequest, type FakeScript } from "@hub/llm";
import { loadLens, type LoadedLens } from "../src/lens/load";
import { openWatchStore, type WatchStore } from "../src/store/repo";

// Shared test helpers of @hub/watch: a store in the test's temp root, the acme fixture lens, and a scripted fake model.

export const fixtures = resolve(import.meta.dirname, "fixtures", "packages");

export function tempStore(project = "acme"): WatchStore {
  return openWatchStore(join(mkdtempSync(join(tmpdir(), "watch-")), `${project}.db`), { project });
}

export async function acmeLens(): Promise<LoadedLens> {
  const r = await loadLens(fixtures, "watch-acme");
  if (!r.ok) throw new Error(r.reason);
  return r.lens;
}

/** The `[n] author: text` lines of a window request. */
export const linesOf = (req: ChatRequest): string[] => (req.messages.at(-1)?.content ?? "").split("\n");

export function fakeLlm(script: FakeScript) {
  const ledger = memoryLedger();
  const transport = fakeTransport(script);
  return { ledger, transport, llm: createLlm({ ledger, transport, retry: { sleep: async () => {}, random: () => 0 } }) };
}

/** An acme window answer with the given moments (other fields filled). */
export const answer = (moments: Array<Partial<Record<string, unknown>> & { message_index: number }>, extra: { topics?: string[]; mood?: string } = {}) =>
  JSON.stringify({
    threads: ["a thread"],
    dominant_topics: extra.topics ?? ["mowers"],
    mood: extra.mood ?? "calm",
    moments: moments.map((m) => ({ speaker_role: "own_problem", is_advert: false, trigger: "broken_tool", trigger_other: "", reactor_indexes: [], quote: "my mower died", thread_context: "mowers", intensity: 3, fit_reason: "fits", ...m })),
  });
