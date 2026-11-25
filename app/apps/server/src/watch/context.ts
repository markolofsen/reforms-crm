import type { WatchDomain } from "./start";

/** The watch domain's context (P144): the started domain, absent in a test app that does not wire it (its routes answer 404). */
export type WatchContext = {
  domain?: WatchDomain;
  adminPort: number;
  now: () => Date;
  /** The watch task's spend this month, from the ledger (`llm_calls`, the task column). */
  monthCost: (task: string) => Promise<number>;
};
