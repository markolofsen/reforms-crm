import type { HubPaths } from "@hub/config/paths";
import type { AppsDto } from "@hub/contract/local";
import type { OpsStore } from "@hub/log/ops";
import type { ConnectionsService } from "./connections";
import type { AutostartService } from "./autostart";
import type { CoreUpdatesService } from "./core-updates";

/** The instance domain's context (P126 S1): the instance's facts, Connections, autostart, the core update check, the ops log. */
export type InstanceContext = {
  now: () => Date;
  adminPort: number;
  connections: ConnectionsService;
  paths?: Pick<HubPaths, "configFile" | "configDir">;
  localOpen?: () => boolean;
  /** P131 O2: the destination apps of this Mac; none when the server cannot open locally. */
  apps?: () => AppsDto;
  core?: CoreUpdatesService;
  autostart?: AutostartService;
  opsLog?: OpsStore;
};
