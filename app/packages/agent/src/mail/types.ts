// The draft use case's own types (P126 M2): the write record, the signed body and a revision. The writer's types are `@hub/mail-app/writer/types`.
import type { ReplyDraftResult } from "@hub/mail-app/writer/types";

/**
 * The Hub's record of one write (P65 S5, `mail_writes`, decision 0031 addendum point 1): started before Mail is asked to
 * save, settled when the saved draft is found, and given Mail's reply shell when the writer saw it. Best effort: a failed
 * record never stops or fails the write.
 */
export interface WriteLog {
  start(text: string): Promise<number>;
  settle(id: number, saved: { mailId: number; messageId: string }): Promise<void>;
  shell(id: number, text: string): Promise<void>;
}

/** What the writer adds when it signs (P60): the signed body and how the brand was found. */
export interface Signed {
  body: string;
  wroteTo: string | null;
  brand: string | null;
  brandReason: string;
  /** `signed`: sign-off and the brand's lines; `placeholder`: `[Owner: signature for ...]`; `none`: the project signs with nothing. */
  signature: "signed" | "placeholder" | "none";
  /** P65 S2: the reply's language had no sign-off or signature line, so it was signed in English. */
  signatureFallback?: string;
}

/** A revision as the writer saved it, with the account it sits in (the version row's account) and why its From is what it is (P58). */
export type Revision = ReplyDraftResult & { replyTo: number; account: string; fromReason: string | null; clientWroteTo: string | null } & Partial<Omit<Signed, "body">>;
