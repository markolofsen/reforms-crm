import { claudeBrain, fakeBrain } from "@hub/agent/autopilot";
import type { AutopilotBrain } from "@hub/config/autopilot";
import { throwawayDb, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { ops } from "@hub/log/ops";

// Which brain this server's autopilot gets (P139 A3, verdict 24), chosen once at start:
// - `HUB_AUTOPILOT_BRAIN=fake`: the scripted fake (no model), and only with a throwaway database (`HUB_DB`): an e2e run;
// - a throwaway database without it, or a test run (`VITEST`): none, so nothing ever spawns a model there;
// - otherwise the real one: one `claude -p` per turn on the owner's Claude sign-in, beside the Hub's own Node.

export function autopilotBrainOf(o: { env: NodeJS.ProcessEnv; paths: HubPaths; repos: Repos; nodeBin?: string }): AutopilotBrain | undefined {
  const throwaway = throwawayDb(o.paths);
  if (o.env.HUB_AUTOPILOT_BRAIN === "fake") {
    if (throwaway) return fakeBrain({ repos: o.repos });
    ops("autopilot").error("HUB_AUTOPILOT_BRAIN=fake is refused without a throwaway HUB_DB: this server's autopilot has no brain");
    return undefined;
  }
  if (throwaway || o.env.VITEST) return undefined;
  return claudeBrain({ paths: o.paths, nodeBin: o.nodeBin ?? process.execPath });
}
