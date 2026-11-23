import { normalizeAddress } from "@hub/projects/parse";

// The address helpers of the send door (`assess`, `findMail`, `deliver`, `runDue`): internal, not exported by `@hub/send`.

export const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
export const addresses = (v: string | null | undefined): string[] => (v?.match(ADDRESS) ?? []).map(normalizeAddress);
export const norm = (list: string[]): string[] => [...new Set(list.map(normalizeAddress))].sort();
export const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export const DAY_MS = 86_400_000;
