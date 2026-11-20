import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiFailure, sentence } from "@/lib/api/client";

// The send door's two steps, once for every channel (decision 0011; P71 M4 for messengers): a dry run that sends nothing and
// returns exactly what would go out, then, after the person confirmed what he saw, the apply with exactly that. Mail's card and the
// Messengers panel each hand it their own `SendDoor`; neither copies the steps.

export type SendFlow<P> =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "confirm"; mail: P }
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

const refusal = <P>(e: unknown): SendFlow<P> => (e instanceof ApiFailure && e.refused.length > 0 ? { step: "refused", reasons: e.refused } : { step: "failed", message: sentence(e) });

export function useSendDoor<P>(door: SendDoor<P>) {
  const [flow, setFlow] = useState<SendFlow<P>>({ step: "idle" });
  const preview = useMutation({
    mutationFn: () => door.preview(),
    onMutate: () => setFlow({ step: "reading" }),
    onSuccess: (mail) => setFlow({ step: "confirm", mail }),
    onError: (e) => setFlow(refusal<P>(e)),
  });
  const send = useMutation({
    mutationFn: (mail: P) => door.send(mail),
    onMutate: (mail) => setFlow({ step: "sending", mail }),
    onSuccess: (_r, mail) => {
      setFlow({ step: "sent" });
      door.sent?.(mail);
      void door.settle();
    },
    onError: (e) => {
      setFlow(refusal<P>(e));
      void door.settle();
    },
  });
  return { flow, read: () => preview.mutate(), send: (mail: P) => send.mutate(mail), close: () => setFlow({ step: "idle" }) };
}
