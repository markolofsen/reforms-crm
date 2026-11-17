// How the server starts and stops, kept out of `main.ts` (which starts a real server on import) so the rules can be tested.

/** The one line printed when the port cannot be taken, or undefined for any other listen error (that one keeps its stack). */
export function listenErrorLine(err: unknown, host: string, port: number): string | undefined {
  const code = (err as { code?: string } | null)?.code;
  if (code === "EADDRINUSE") return `error: port ${port} on ${host} is already in use (another hub server of this instance, or another program): stop it, or set api_port in config/config.json`;
  if (code === "EACCES") return `error: no permission to listen on ${host}:${port}: choose a port above 1023 (api_port in config/config.json)`;
  return undefined;
}

/**
 * Stop on SIGINT and SIGTERM: run `stop`, then exit 0 (1 when stopping throws). A stuck poller must not make the signal hang for ever, so after `deadlineMs`
 * the process exits anyway with 1 (the timer never keeps it alive on its own). A second signal while stopping is ignored.
 */
export function onShutdown(opts: { stop: () => Promise<void>; exit: (code: number) => void; deadlineMs: number; log?: (line: string) => void; signals?: { on(sig: string, fn: () => void): unknown } }): void {
  const signals = opts.signals ?? process;
  let stopping = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    signals.on(sig, () => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => { opts.log?.(`shutdown: still stopping after ${opts.deadlineMs / 1000} s, exiting anyway`); opts.exit(1); }, opts.deadlineMs).unref();
      void opts.stop().then(() => opts.exit(0), (e: unknown) => { opts.log?.(`shutdown: stopping failed: ${e instanceof Error ? e.message : String(e)}`); opts.exit(1); });
    });
  }
}
