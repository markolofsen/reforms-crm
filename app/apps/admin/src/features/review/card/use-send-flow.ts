import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SendPreviewDto } from "@hub/contract/responses";
import { ApiFailure, refreshData, sentence } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";

export type SendFlow =
  | { step: "idle" }
  | { step: "reading" }
  | { step: "confirm"; mail: SendPreviewDto }
  | { step: "sending"; mail: SendPreviewDto }
  | { step: "refused"; reasons: string[] }
  | { step: "failed"; message: string }
  | { step: "sent" };

const refusal = (e: unknown): SendFlow => (e instanceof ApiFailure && e.refused.length > 0 ? { step: "refused", reasons: e.refused } : { step: "failed", message: sentence(e) });

/**
 * The two steps of a send: read the draft from Mail (a dry run that sends nothing), then, after the person confirms
 * what they saw, send exactly that. Nothing is queued and nothing goes out without the second step.
 */
export function useSendFlow(project: string, draftId: number) {
  const qc = useQueryClient();
  const [flow, setFlow] = useState<SendFlow>({ step: "idle" });
  const preview = useMutation({
    mutationFn: () => sendApi.preview(project, draftId),
    onMutate: () => setFlow({ step: "reading" }),
    onSuccess: (mail) => setFlow({ step: "confirm", mail }),
    onError: (e) => setFlow(refusal(e)),
  });
  const send = useMutation({
    mutationFn: (mail: SendPreviewDto) => sendApi.send(project, draftId, { to: mail.to, subject: mail.subject }),
    onMutate: (mail) => setFlow({ step: "sending", mail }),
    onSuccess: () => {
      setFlow({ step: "sent" });
      void refreshData(qc, { mail: true });
    },
    onError: (e) => {
      setFlow(refusal(e));
      void refreshData(qc, { mail: true });
    },
  });
  return { flow, read: () => preview.mutate(), send: (mail: SendPreviewDto) => send.mutate(mail), close: () => setFlow({ step: "idle" }) };
}

/** Answers true once per send: the first time it sees `sent`, never again until `sent` has been false. */
export function sendLatch(): (sent: boolean) => boolean {
  let fired = false;
  return (sent) => {
    if (!sent) {
      fired = false;
      return false;
    }
    if (fired) return false;
    fired = true;
    return true;
  };
}

/**
 * Runs `announce` once per send, when the flow first reads `sent`. `announce` is read through a ref: the card passes a
 * new function every render, and a re-render after the refetch must not toast and advance a second time (the second
 * advance would find the sent draft gone from the list and jump to the top of it).
 */
export function useOnSent(sent: boolean, announce: () => void): void {
  const latest = useRef(announce);
  const latch = useRef(sendLatch());
  useEffect(() => {
    latest.current = announce;
  });
  useEffect(() => {
    if (latch.current(sent)) latest.current();
  }, [sent]);
}
