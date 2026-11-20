import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { UserLoginStartBody } from "@hub/contract/messengers";
import { sentence } from "@/lib/api/client";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { keys } from "@/lib/cache/keys";

export const useTelegramUser = () => useQuery({ queryKey: keys.telegramUser(), queryFn: telegramUserApi.status });

/** Where the connect form stands: the first step, the code, the 2FA password, or done with the owner's own display name. */
export type LoginStep = { step: "start" } | { step: "code"; flow: string } | { step: "password"; flow: string } | { step: "done"; name: string };

/**
 * The connect form's steps over M1's routes (decision 0036 point 4), one call each. The flow id lives in this state only; the
 * api_hash, phone, code and password are arguments of one call and are kept nowhere (no query key, no mutation variables, no
 * address). One sentence reaches the live region: a refusal (wrong code, Telegram's answer) is an alert.
 */
export function useTelegramLogin() {
  const qc = useQueryClient();
  const [state, setState] = useState<LoginStep>({ step: "start" });
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  const run = useCallback(
    async (call: () => Promise<{ step: "code" | "password"; flow: string } | { step: "done"; account: string; name: string }>) => {
      setBusy(true);
      setAlert(null);
      try {
        const r = await call();
        setState(r.step === "done" ? { step: "done", name: r.name } : { step: r.step, flow: r.flow });
        if (r.step === "done") await qc.invalidateQueries({ queryKey: keys.telegramUser() });
      } catch (e) {
        setAlert(sentence(e));
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  const start = useCallback((b: UserLoginStartBody) => run(() => telegramUserApi.start(b)), [run]);
  const code = useCallback((c: string) => (state.step === "code" ? run(() => telegramUserApi.code(state.flow, c)) : undefined), [run, state]);
  const password = useCallback((p: string) => (state.step === "password" ? run(() => telegramUserApi.password(state.flow, p)) : undefined), [run, state]);
  const cancel = useCallback(async () => {
    if (state.step === "code" || state.step === "password") await telegramUserApi.cancel(state.flow).catch(() => undefined);
    setAlert(null);
    setState({ step: "start" });
  }, [state]);
  return { state, busy, alert, start, code, password, cancel };
}
