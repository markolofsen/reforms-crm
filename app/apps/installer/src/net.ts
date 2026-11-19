import { createServer } from "node:net";

export const adminUrl = (port: number): string => `http://127.0.0.1:${port}`;

/** True when something already listens on 127.0.0.1:`port`. */
export const portBusy = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(true));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(false)));
  });

/** `GET /api/health` on 127.0.0.1:`port` answers 200. */
export async function healthy(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}
