#!/usr/bin/env tsx
// Stand-alone entry: `pnpm --filter @hub/projects project sync|show|doctor`. `pnpm hub project ...` uses
// hub-commands.ts from the installer.
import { Command } from "commander";
import { registerProjectCommands } from "./hub-commands";

const program = new Command("hub").description("Hub Workflow projects");
program.option("--root <dir>", "projects folder (default: <HUB_HOME>/projects)");
registerProjectCommands(program, {});
program.hook("preAction", () => {
  const root = program.opts().root as string | undefined;
  if (root) process.env.HUB_PROJECTS = root;
});
await program.parseAsync(process.argv);
