import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UserLoginStartBody, UserLoginStepDto } from "@hub/contract/messengers";
import { ApiFailure, sentence } from "@/lib/api/client";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { keys } from "@/lib/cache/keys";

export const useTelegramUser = () => useQuery({ queryKey: keys.telegramUser(), queryFn: telegramUserApi.status });

/** The QR rows and flow live only in form state, never in a query cache or address. */
export type LoginStep = { step: "start" } | Exclude<UserLoginStepDto, { step: "done" }> | { step: "done"; name: string };

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
  const activeQrFlow = useRef<string | null>(null);
  const mounted = useRef(true);
  const qrFlow = state.step === "qr" ? state.flow : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activeQrFlow.current) void telegramUserApi.cancel(activeQrFlow.current).catch(() => undefined);
    };
  }, []);

  const run = useCallback(
    async (call: () => Promise<UserLoginStepDto>) => {
      setBusy(true);
      setAlert(null);
      try {
        const r = await call();
        if (!mounted.current) {
          if (r.step === "qr") await telegramUserApi.cancel(r.flow).catch(() => undefined);
          return;
        }
        if (r.step === "qr") activeQrFlow.current = r.flow;
        if (r.step === "done") activeQrFlow.current = null;
        setState(r.step === "done" ? { step: "done", name: r.name } : r);
        if (r.step === "done") await qc.invalidateQueries({ queryKey: keys.telegramUser() });
      } catch (e) {
        if (mounted.current) setAlert(sentence(e));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [qc],
  );

  useEffect(() => {
    if (!qrFlow) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await telegramUserApi.loginStatus(qrFlow);
        if (!live || activeQrFlow.current !== qrFlow) return;
        setAlert(null);
        if (r.step === "done") {
          activeQrFlow.current = null;
          setState({ step: "done", name: r.name });
          await qc.invalidateQueries({ queryKey: keys.telegramUser() });
          return;
        }
        if (r.step === "password" || r.step === "code") {
          setState(r);
          return;
        }
        setState(r);
      } catch (e) {
        if (!live || activeQrFlow.current !== qrFlow) return;
        if (e instanceof ApiFailure && e.status === 409) {
          activeQrFlow.current = null;
          setState({ step: "start" });
          setAlert(`${sentence(e)} Start a new login.`);
          return;
        }
        setAlert(sentence(e));
      }
      if (live && activeQrFlow.current === qrFlow) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [qrFlow, qc]);

  const start = useCallback((b: UserLoginStartBody) => run(() => telegramUserApi.start(b)), [run]);
  const code = useCallback((c: string) => (state.step === "code" ? run(() => telegramUserApi.code(state.flow, c)) : undefined), [run, state]);
  const password = useCallback((p: string) => (state.step === "password" ? run(() => telegramUserApi.password(state.flow, p)) : undefined), [run, state]);
  const cancel = useCallback(async () => {
    const qr = activeQrFlow.current;
    if (qr) {
      try {
        await telegramUserApi.cancel(qr);
      } catch (e) {
        if (mounted.current && activeQrFlow.current === qr) setAlert(sentence(e));
        return;
      }
      if (!mounted.current || activeQrFlow.current !== qr) return;
    }
    activeQrFlow.current = null;
    setAlert(null);
    setState({ step: "start" });
    if (!qr && (state.step === "code" || state.step === "password")) await telegramUserApi.cancel(state.flow).catch(() => undefined);
  }, [state]);
  return { state, busy, alert, start, code, password, cancel };
}
