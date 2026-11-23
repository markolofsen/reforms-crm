import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiFailure, sentence } from "@/lib/api/client";

// The send door's two steps, once for every channel (decision 0011; P71 M4 for messengers): a dry run that sends nothing and
// returns exactly what would go out, then the apply with exactly that. P105: the person confirms in the review dialog BEFORE the
// dry run, on what the dialog showed, so the two steps run as one call (`go`) and the apply happens only when the dry run's
// answer is what the dialog showed (`accept`). Mail's card (`lib/data/drafts.ts`) and the Messengers panel (`lib/data/messengers.ts`)
// each hand it their own `SendDoor` (P127 C2: the door moved here from `components/send/`, so no feature runs a mutation).

export type SendFlow<P> =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "sending"; mail: P }
  | { step: "refused"; reasons: string[] }
  | { step: "failed"; message: string }
  | { step: "sent" };

/** One draft's door: the dry run, the apply with what was previewed, and what to read again after either. */
export interface SendDoor<P> {
  preview: () => Promise<P>;
  send: (previewed: P) => Promise<unknown>;
  settle: () => unknown;
  /** Once, when the apply answered sent (the panel's toast). */
  sent?: (previewed: P) => void;
}

/**
 * The dialog's confirm: `before` runs first (Mail's acknowledgements and Checked, bound to the text read); `accept` judges the dry
 * run's answer against what the dialog showed and returns why not in words, or null to send it.
 */
export type Go<P> = { before?: () => Promise<unknown>; accept?: (previewed: P) => string | null };

const refusal = <P>(e: unknown): SendFlow<P> => (e instanceof ApiFailure && e.refused.length > 0 ? { step: "refused", reasons: e.refused } : { step: "failed", message: sentence(e) });

export function useSendDoor<P>(door: SendDoor<P>) {
  const [flow, setFlow] = useState<SendFlow<P>>({ step: "idle" });
  const go = useMutation({
    mutationFn: async (o: Go<P>): Promise<{ mail: P; refused: string | null }> => {
      await o.before?.();
      const mail = await door.preview();
      const refused = o.accept?.(mail) ?? null;
      if (refused !== null) return { mail, refused };
      setFlow({ step: "sending", mail });
      await door.send(mail);
      return { mail, refused: null };
    },
    onMutate: () => setFlow({ step: "reading" }),
    onSuccess: ({ mail, refused }) => {
      if (refused !== null) setFlow({ step: "refused", reasons: [refused] });
      else {
        setFlow({ step: "sent" });
        door.sent?.(mail);
      }
      void door.settle();
    },
    onError: (e) => {
      setFlow(refusal<P>(e));
      void door.settle();
    },
  });
  return { flow, go: (o: Go<P> = {}) => go.mutate(o), close: () => setFlow({ step: "idle" }) };
}

/** The reasons a refused or failed send gives, as the review dialog's blockers. */
export const flowProblems = (flow: SendFlow<unknown>): string[] => (flow.step === "refused" ? flow.reasons : flow.step === "failed" ? [flow.message] : []);
