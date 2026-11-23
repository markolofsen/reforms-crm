import { readInstanceConfig } from "@hub/config/instance";
import { normalizeAddress, type ProjectConfig } from "./parse";

export type GuardResult = { ok: true } | { ok: false; blocked: string[] };

/**
 * The `draft.recipients` guard of doc 16 section 8: who a draft may go to. `test` means the global allow_list of
 * config/config.json, `any` means anyone, a list means exactly those addresses. Every address of To and Cc must pass.
 */
export function checkDraftRecipients(config: Pick<ProjectConfig, "draft">, to: string[], allowList: string[]): GuardResult {
  const rule = config.draft.recipients;
  if (rule === "any") return { ok: true };
  const allowed = new Set((rule === "test" ? allowList : rule).map(normalizeAddress));
  const blocked = to.map(normalizeAddress).filter((a) => !allowed.has(a));
  return blocked.length ? { ok: false, blocked } : { ok: true };
}

/** `allow_list` of config/config.json (what `draft.recipients: test` means); empty when the file is missing or unreadable. */
export const readAllowList = (file: string): string[] => readInstanceConfig({ configFile: file }).config.allow_list ?? [];

/** P92: the owner's test addresses when the project is in test mode (`draft.recipients: test`), normalized; else none. */
export function testRecipientsOf(config: Pick<ProjectConfig, "draft">, allowList: readonly string[]): string[] {
  return config.draft.recipients === "test" ? [...new Set(allowList.map(normalizeAddress))] : [];
}
