import { probeNotion, probeTelegram, type Verdict } from "@hub/connections";
import type { Ctx } from "../context";

/** Every outside call of the wizard. Tests inject fakes; none of them ever prints or returns a secret. The probes themselves live in `@hub/connections`. */
export interface Validators {
  notion(token: string): Promise<Verdict>;
  telegram(token: string): Promise<Verdict>;
}

export function makeValidators(ctx: Ctx): Validators {
  const deps = { fetch: ctx.fetch };
  return { notion: (t) => probeNotion(deps, t), telegram: (t) => probeTelegram(deps, t) };
}
