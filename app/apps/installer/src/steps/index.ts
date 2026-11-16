import type { Step } from "../types.ts";
import { adminSteps } from "./admin.ts";
import { fileSteps } from "./files.ts";
import { mailSteps } from "./mail.ts";
import { messengerSteps } from "./messengers.ts";
import { notionSteps } from "./notion.ts";
import { projectSteps } from "./projects.ts";
import { skillSteps } from "./skills.ts";
import { toolSteps } from "./tools.ts";

const tag = (steps: Step[], optional: NonNullable<Step["optional"]>, ids?: string[]): Step[] =>
  steps.map((s) => (!ids || ids.includes(s.id) ? { ...s, optional } : s));

/**
 * The single step list. install, doctor, guide and client-setup.md all read this. Order = install order.
 * Manual-first (decision 0006): a step with `optional` set belongs to the OFF-by-default extras (a Notion token, a mail login,
 * the Telegram poller) or to UI development and never fails a default `setup`, `install` or `doctor`.
 * The launchd, Claude-token, gate, sound and power steps were archived by P25 (the archived installer-automation material (not part of this repo)).
 */
export const STEPS: Step[] = [
  ...toolSteps,
  ...tag(fileSteps, "automation", ["files.settings"]),
  ...tag(skillSteps, "dev", ["skills.dev"]),
  ...projectSteps,
  ...adminSteps,
  ...tag(mailSteps, "automation", ["mail.account"]),
  ...tag(messengerSteps, "automation"),
  ...tag(notionSteps, "automation", ["notion.token"]),
];

/** What a manual session needs. `--automation` adds the optional extras; dev steps run only by `--only`. */
export const selectSteps = (automation: boolean): Step[] => STEPS.filter((s) => !s.optional || (automation && s.optional === "automation"));
