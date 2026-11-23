import type { HealthDto } from "@hub/contract/health";
import type { OverviewService } from "./overview";
import type { SchemeSources } from "./scheme";

/** The overview domain's context (P126 S1): health, the Overview and the scheme. */
export type OverviewContext = {
  health: () => HealthDto;
  dataVersion: () => number;
  now: () => Date;
  overview: OverviewService;
  scheme: SchemeSources;
};
