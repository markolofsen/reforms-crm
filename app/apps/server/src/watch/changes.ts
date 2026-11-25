import type { WatchConfig } from "@hub/watch/config";
import type { LoadedLens } from "@hub/watch/lens";

// P153 (plan verdict 6): what changed in a watch list or a lens, in the owner's words, for its one Activity line. Names of
// public groups and trigger values only: never a quote, a person or a prompt's text.

const list = (xs: readonly string[], f: (x: string) => string = (x) => x): string => (xs.length <= 3 ? xs.map(f).join(" ") : `${xs.slice(0, 3).map(f).join(" ")} and ${xs.length - 3} more`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function configChanges(a: WatchConfig, b: WatchConfig): string[] {
  const out: string[] = [];
  const added = b.groups.filter((g) => !a.groups.includes(g));
  const removed = a.groups.filter((g) => !b.groups.includes(g));
  if (added.length) out.push(`+${plural(added.length, "group")} (${list(added, (g) => `@${g}`)})`);
  if (removed.length) out.push(`-${plural(removed.length, "group")} (${list(removed, (g) => `@${g}`)})`);
  if (a.on !== b.on) out.push(b.on ? "switched on" : "switched off");
  if (a.pollMinutes !== b.pollMinutes) out.push(`polled every ${b.pollMinutes} min`);
  return out;
}

export function lensChanges(a: LoadedLens, b: LoadedLens): string[] {
  const out: string[] = [];
  if (a.task.version !== b.task.version) out.push(`v${a.task.version} to v${b.task.version}`);
  const added = b.triggers.filter((t) => !a.triggers.includes(t));
  const removed = a.triggers.filter((t) => !b.triggers.includes(t));
  if (added.length) out.push(`+${plural(added.length, "trigger")} (${list(added)})`);
  if (removed.length) out.push(`-${plural(removed.length, "trigger")} (${list(removed)})`);
  const relabelled = b.triggers.filter((t) => a.triggers.includes(t) && a.labels[t] !== b.labels[t]);
  if (relabelled.length) out.push(`${plural(relabelled.length, "label")} renamed`);
  if (a.task.system !== b.task.system) out.push("prompt changed");
  if (a.title !== b.title) out.push(`title "${b.title}"`);
  if (a.task.shape.size !== b.task.shape.size || a.task.shape.overlap !== b.task.shape.overlap) out.push(`windows of ${b.task.shape.size} (overlap ${b.task.shape.overlap})`);
  if (a.task.budget?.monthlyUsd !== b.task.budget?.monthlyUsd) out.push(`budget $${b.task.budget?.monthlyUsd ?? 2} a month`);
  // A change of the triggers' meanings shows only in the schema the model is sent.
  if (out.length === 0 && JSON.stringify(a.task.wire) !== JSON.stringify(b.task.wire)) out.push("trigger meanings changed");
  return out;
}
