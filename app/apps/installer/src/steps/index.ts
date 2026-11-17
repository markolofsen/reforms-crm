import type { Step } from "../types.ts";
import { adminSteps } from "./admin.ts";
import { backupSteps } from "./backup.ts";
import { fileSteps } from "./files.ts";
import { instanceSteps } from "./instance.ts";
import { mailSteps } from "./mail.ts";
import { mcpSteps } from "./mcp.ts";
import { messengerSteps } from "./messengers.ts";
import { notionSteps } from "./notion.ts";
import { projectSteps } from "./projects.ts";
import { serverSteps } from "./server.ts";
import { skillSteps } from "./skills.ts";
import { toolSteps } from "./tools.ts";

const tag = (steps: Step[], optional: NonNullable<Step["optional"]>, ids?: string[]): Step[] =>
  steps.map((s) => (!ids || ids.includes(s.id) ? { ...s, optional } : s));

/**
 * The single step list. install, doctor, guide and @docs/setup/checklist.md all read this. Order = install order.
 * Manual-first (decision 0006): a step with `optional` set belongs to the OFF-by-default extras (a Notion token, a mail login,
 * the Telegram poller) and never fails a default `setup`, `install` or `doctor`.
 * The launchd, Claude-token, gate, sound and power steps were archived by P25 (the archived installer-automation material (not part of this repo)).
 */
export const STEPS: Step[] = [
  ...toolSteps,
  ...tag(fileSteps, "automation", ["files.settings"]),
  ...skillSteps,
  ...projectSteps,
  ...instanceSteps,
  ...adminSteps,
  ...serverSteps,
  ...mcpSteps,
  ...tag(mailSteps, "automation", ["mail.account"]),
  ...tag(messengerSteps, "automation"),
  ...tag(notionSteps, "automation", ["notion.token", "notion.access"]),
  ...backupSteps.map((s): Step => ({ ...s, audit: true })),
];

/** What a manual session needs. `--automation` adds the optional extras; dev steps run only by `--only`; `audit` (doctor only) adds the backup checks. */
export const selectSteps = (automation: boolean, audit = false): Step[] => STEPS.filter((s) => (audit || !s.audit) && (!s.optional || (automation && s.optional === "automation")));
