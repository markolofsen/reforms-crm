// P126 C1: the helpers every `hub` command file shares; each is lazy, so a command that needs no instance never builds one.
import { readInstanceConfig } from "@hub/config/instance";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeCtx, type Ctx } from "../context";
import { mcpCall } from "../mcp-probe";
import { notionCheck } from "../notion-check";
import { probeBookingLink } from "../booking-probe";
import { selectSteps, STEPS } from "../steps/index";
import type { Step } from "../types";

export const ctxOf = (extra: Partial<Ctx> = {}): Ctx => makeCtx(extra);

export const pick = (ids?: string[], automation = false, audit = false): Step[] => {
  if (!ids?.length) return selectSteps(automation, audit);
  const unknown = ids.filter((i) => !STEPS.some((s) => s.id === i || s.group.toLowerCase() === i.toLowerCase()));
  if (unknown.length) throw new Error(`unknown step or group: ${unknown.join(", ")}`);
  return STEPS.filter((s) => ids.includes(s.id) || ids.some((i) => i.toLowerCase() === s.group.toLowerCase()));
};

// P7: `hub project sync|show|doctor`; account names come from the mail-mcp daemon (read-only).
// `undefined`: Mail could not be asked (Mail.app closed, mail-mcp down): the check is skipped. An empty list means Mail answered and has none.
export async function mailAccounts(ctx: Ctx): Promise<string[] | undefined> {
  const r = await mcpCall(ctx, ctx.mailUrl, "list_accounts", { enabled: true });
  if (!r.ok) return undefined;
  try {
    const j = JSON.parse(r.text);
    const list: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.accounts) ? j.accounts : [];
    return list.map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  } catch {
    const acc = readInstanceConfig(ctx.paths).config.account;
    return acc && r.text.includes(acc) ? [acc] : [];
  }
}
// Projects folder: `<HUB_HOME>/projects` (or HUB_PROJECTS). The context is built lazily, when a command runs.
// Manual-first: without a Notion token file (the optional automation token) the Notion read is skipped, not failed;
// the session reads Notion through its own connector. A project with its own `notion.token_file` is still checked.
export const projectOptions = () => ({
  mailAccounts: () => mailAccounts(ctxOf()),
  bookingProbe: (url: string) => probeBookingLink(url),
  notionCheck: async (p: Parameters<typeof notionCheck>[1]) => {
    const ctx = ctxOf();
    const { tokenFile } = p.parsed.config.notion;
    if (tokenFile === "notion-token" && !existsSync(path.join(ctx.configDir, tokenFile))) {
      return { ok: true, skipped: true, detail: "no Notion token file: not read (manual sessions use the Notion connector; `hub setup --automation` adds one)" };
    }
    return notionCheck(ctx, p);
  },
});
export const projectsDir = () => ctxOf().paths.projects;
// Folder holding state/evidence/...: the hub root; HUB_LEDGER_ROOT overrides it, so tests never write the live ledger.
export const ledgerRoot = () => process.env.HUB_LEDGER_ROOT ?? ctxOf().paths.home;
export const done = (code: number) => { process.exitCode = code; };
