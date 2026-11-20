import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { SendPreviewDto } from "@hub/contract/responses";
import { useSendDoor, type SendFlow as DoorFlow } from "@/components/send/send-flow";
import { refreshData } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";

export type SendFlow = DoorFlow<SendPreviewDto>;

/**
 * The two steps of a mail send through the one door (`components/send/send-flow.ts`): read the draft from Mail (a dry run that
 * sends nothing), then, after the person confirms what they saw, send exactly that (the recipients and subject he read).
 */
export function useSendFlow(project: string, draftId: number) {
  const qc = useQueryClient();
  return useSendDoor<SendPreviewDto>({
    preview: () => sendApi.preview(project, draftId),
    send: (mail) => sendApi.send(project, draftId, { to: mail.to, subject: mail.subject }),
    settle: () => refreshData(qc, { mail: true }),
  });
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
