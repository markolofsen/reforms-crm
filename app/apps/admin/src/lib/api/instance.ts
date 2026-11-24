import { checkApps, checkCoreUpdate, getGetInstanceLogoUrl, getStreamLiveUrl, getCoreUpdate, getInstance, getPulse, listProjects, openLocal } from "@hub/api";
import { pulseDto } from "@hub/contract/health";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { appsDto, LOCAL_ACTIONS, localOpenedDto, type ServerActionId } from "@hub/contract/local";
import { projectsDto } from "@hub/contract/project";
import { readGenerated } from "./client";

/** The instance (P127 V13): its brand and core update notice (P68), the projects, the pulse, the live stream's URL, the apps this Mac has and the one local Open (P61). */
export const instanceApi = {
  instance: () => readGenerated(getInstance(), instanceDto),
  /** The brand's logo file, an <img> source (`@hub/api/ledger` URL_HELPERS). */
  logoUrl: (): string => getGetInstanceLogoUrl(),
  /** The live stream's URL (SSE, opened by `lib/cache/live.ts`), after the last applied counter when the page has one. */
  streamUrl: (after: number | null): string => getStreamLiveUrl(after === null ? undefined : { since: String(after) }),
  /** P68: the server's cached answer; `checkCore` runs one check now (429 within a minute). */
  core: () => readGenerated(getCoreUpdate(), coreUpdateDto),
  checkCore: () => readGenerated(checkCoreUpdate(), coreUpdateDto),
  /** P131 O2: Settings ▸ This Mac's Check again: which destination apps this Mac has, probed now (nothing opens). */
  checkApps: () => readGenerated(checkApps(), appsDto),
  projects: () => readGenerated(listProjects(), projectsDto),
  pulse: () => readGenerated(getPulse(), pulseDto),
  /** P61: the only local Open (a project and a key; the server resolves the path and checks `args` against the action's own schema). Called by `lib/data/instance.ts` (`postLocalOpen`). */
  localOpen: (action: ServerActionId, args: unknown) => {
    const checked = LOCAL_ACTIONS[action].args.safeParse(args);
    if (!checked.success) return Promise.reject(new Error(`This Open was given the wrong details: ${checked.error.issues[0]?.message ?? "invalid"}.`));
    return readGenerated(openLocal(action, checked.data), localOpenedDto);
  },
};
