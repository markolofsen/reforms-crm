import type { OpenRun, ResolveDeps } from "@hub/projects/local-open";
import type { AppsProbe } from "../instance/apps-probe";

export interface LocalService {
  deps: ResolveDeps;
  run: OpenRun;
  available: boolean;
  now?: () => number;
  /** P131 O2: which destination apps this Mac has (`apps` on the instance), and Check again. */
  apps?: Pick<AppsProbe, "status" | "check">;
}

/** The local Open actions' context (P61); absent, `POST /api/local/:action` is 404. */
export type LocalContext = { local?: LocalService; adminPort: number };
