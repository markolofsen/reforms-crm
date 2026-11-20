import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { WaConnectStepDto } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";

export const useWhatsApp = () => useQuery({ queryKey: keys.whatsapp(), queryFn: whatsappApi.status });

/** How often the admin asks for the pairing's state while it waits: WhatsApp shows a new QR code about every 20 s. */
export const PAIRING_POLL_MS = 2000;

const ended = (s: WaConnectStepDto | undefined) => s?.step === "done" || s?.step === "failed";

/**
 * The WhatsApp Connect (decision 0036 point 4): nothing happens until the owner presses Connect; then the server opens a pairing
 * and the admin reads its state every 2 s (the QR code to scan, then done or failed) until it ends or he cancels. The server drops
 * a pairing once its end is read, so the reads stop there. The flow id lives in this state only; the QR code is never cached past
 * the pairing (`gcTime: 0`).
 */
export function useWhatsAppConnect() {
  const qc = useQueryClient();
  const [flow, setFlow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const state = useQuery({
    queryKey: keys.whatsappPairing(flow ?? ""),
    queryFn: async () => {
      const s = await whatsappApi.state(flow ?? "");
      if (s.step === "done") void qc.invalidateQueries({ queryKey: keys.whatsapp() });
      return s;
    },
    enabled: flow !== null,
    refetchInterval: (q) => (ended(q.state.data) || q.state.error ? false : PAIRING_POLL_MS),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const s = flow !== null ? state.data : undefined;

  const connect = useCallback(async () => {
    setBusy(true);
    setRefused(null);
    try {
      setFlow((await whatsappApi.connect()).flow);
    } catch (e) {
      setFlow(null);
      setRefused(sentence(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const cancel = useCallback(async () => {
    if (flow && !ended(state.data)) await whatsappApi.cancel(flow).catch(() => undefined);
    setFlow(null);
    setRefused(null);
  }, [flow, state.data]);

  const failed = s?.step === "failed" ? s.reason : flow !== null && state.isError ? sentence(state.error) : null;
  return {
    active: flow !== null && !ended(s) && !state.isError,
    qr: s?.step === "qr" ? s : null,
    busy,
    alert: refused ?? failed,
    done: s?.step === "done" ? `Linked as ${s.name || `+${s.account}`}.` : null,
    connect,
    cancel,
  };
}
