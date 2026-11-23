import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// P121 T1: the one vitest config of every workspace. Each test file gets its own empty temp root (`temp-root.ts`) and the run
// sweeps the folders an earlier run left (`temp-sweep.ts`, memory "hub tests leave temp folders"); `hermetic` also clears the
// developer's HUB_* and key variables (`hermetic-home.ts`). A workspace's `vitest.config.ts` is one call with what differs.

const support = (file: string): string => fileURLToPath(new URL(`../../../test-support/${file}`, import.meta.url));

export interface HubVitest {
  /** Test globs; vitest's default when left out. */
  include?: string[];
  /** Clear the developer's HUB_* and key variables before each file. */
  hermetic?: boolean;
  /** More setup files, after the shared ones (relative to the workspace). */
  setupFiles?: string[];
  environment?: "node";
  testTimeout?: number;
  /** Resolve the `paths` of the workspace's tsconfig.json (the admin's `@/*`). */
  tsconfigPaths?: boolean;
}

export function hubVitest(o: HubVitest = {}) {
  return defineConfig({
    ...(o.tsconfigPaths ? { resolve: { tsconfigPaths: true } } : {}),
    test: {
      ...(o.include ? { include: o.include } : {}),
      ...(o.environment ? { environment: o.environment } : {}),
      globalSetup: [support("temp-sweep.ts")],
      setupFiles: [support("temp-root.ts"), ...(o.hermetic ? [support("hermetic-home.ts")] : []), ...(o.setupFiles ?? [])],
      ...(o.testTimeout ? { testTimeout: o.testTimeout } : {}),
    },
  });
}
