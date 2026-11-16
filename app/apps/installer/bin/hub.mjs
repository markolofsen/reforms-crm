#!/usr/bin/env node
// `hub` entry point. Runs the TypeScript CLI through tsx, resolved from THIS package, so it works from any
// folder and through a symlink (the real path of this file is what Node resolves against).
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
