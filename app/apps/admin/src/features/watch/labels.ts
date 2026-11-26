import type { WatchDto, WatchState, WatchView } from "@hub/contract/watch";

/** P144: the menu's views, in order, in the owner's words. */
export const VIEW_ORDER: readonly WatchView[] = ["triggers", "topics", "moments", "people", "groups", "trend"];
export const VIEW_LABEL: Record<WatchView, string> = { triggers: "Signals", topics: "Topics", moments: "Moments", people: "People", groups: "Groups", trend: "Trend" };

/** The watcher's standing as one word beside its reason. */
export const STATE_WORD: Record<WatchState, string> = { invalid: "Broken list", lens: "Lens not loaded", off: "Off", no_account: "No account", parked: "Paused", polling: "Reading" };

/** A trigger's readable name: the lens's label, else the value itself. */
export const triggerLabel = (d: Pick<WatchDto, "labels">, trigger: string, other = ""): string => (trigger === "other" && other ? `Other: ${other}` : (d.labels[trigger] ?? trigger));

/** Micro-dollars as dollars with cents (a watch month is cents to a few dollars). */
export const microUsd = (n: number): string => `$${(n / 1e6).toFixed(2)}`;

/** The spend line: this month's cost of the lens task against its own budget. */
export const spendLine = (s: WatchDto["spend"]): string => (s.budgetMicroUsd > 0 ? `${microUsd(s.monthMicroUsd)} of ${microUsd(s.budgetMicroUsd)} this month` : `${microUsd(s.monthMicroUsd)} this month`);
