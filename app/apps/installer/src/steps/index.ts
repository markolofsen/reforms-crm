import type { Step } from "../types";
import { adminSteps } from "./admin";
import { agentSteps } from "./agent";
import { backupSteps } from "./backup";
import { fileSteps } from "./files";
import { instanceSteps } from "./instance";
import { leadSteps } from "./leads";
import { mailSteps } from "./mail";
import { mcpSteps } from "./mcp";
import { messengerSteps } from "./messengers";
import { notionSteps } from "./notion";
import { projectSteps } from "./projects";
import { serverSteps } from "./server";
import { skillSteps } from "./skills";
import { toolSteps } from "./tools";

const tag = (steps: Step[], optional: NonNullable<Step["optional"]>, ids?: string[]): Step[] =>
  steps.map((s) => (!ids || ids.includes(s.id) ? { ...s, optional } : s));

/**
 * The single step list. install, doctor, guide and @docs/setup/checklist.md all read this. Order = install order.
 * Manual-first (decision 0006): a step with `optional` set belongs to the OFF-by-default extras (a Notion token,
 * the Telegram poller) and never fails a default `setup`, `install` or `doctor`.
 * The launchd, Claude-token, gate, sound and power steps were archived by P25 (outside this repo).
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
  ...leadSteps,
  // P49: the Agent tools rows reach every MCP server once per CLI, so they are an audit (`--fast` leaves them out). The terminal
  // row and the CLIs row (P66: one login-shell detection, cached per run) are the install workflow's: setup and install run them.
  ...agentSteps.map((s): Step => (s.id === "agent.tools" ? { ...s, audit: true } : s)),
  ...backupSteps.map((s): Step => ({ ...s, audit: true })),
];

/** What a manual session needs. `--automation` adds the optional extras; dev steps run only by `--only`; `audit` (doctor only) adds the backup checks. */
export const selectSteps = (automation: boolean, audit = false): Step[] => STEPS.filter((s) => (audit || !s.audit) && (!s.optional || (automation && s.optional === "automation")));
