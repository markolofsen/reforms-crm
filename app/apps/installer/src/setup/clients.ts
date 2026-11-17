import { probeImap, probeNotion, probeTelegram, type Verdict } from "@hub/connections";
import { imapflowConnect, type ImapAccount, type ImapConnect } from "@hub/mail/imap";
import type { Ctx } from "../context";

/** Every outside call of the wizard. Tests inject fakes; none of them ever prints or returns a secret. The probes themselves live in `@hub/connections`. */
export interface Validators {
  notion(token: string): Promise<Verdict>;
  telegram(token: string): Promise<Verdict>;
  imap(account: ImapAccount): Promise<Verdict>;
}

export function makeValidators(ctx: Ctx, imapConnect: ImapConnect = imapflowConnect): Validators {
  const deps = { fetch: ctx.fetch, imapConnect };
  return { notion: (t) => probeNotion(deps, t), telegram: (t) => probeTelegram(deps, t), imap: (a) => probeImap(deps, a) };
}
