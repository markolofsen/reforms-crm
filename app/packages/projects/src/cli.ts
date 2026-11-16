#!/usr/bin/env tsx
// Stand-alone entry: `pnpm --filter @hub/projects project sync|show|doctor`. `pnpm hub project ...` uses
// hub-commands.ts from the installer.
import { Command } from "commander";
import { registerProjectCommands } from "./hub-commands.js";

const program = new Command("hub").description("Hub Workflow projects");
program.option("--root <dir>", "projects folder (default: app/projects)");
registerProjectCommands(program, {});
program.hook("preAction", () => {
  const root = program.opts().root as string | undefined;
  if (root) process.env.HUB_PROJECTS = root;
});
await program.parseAsync(process.argv);
