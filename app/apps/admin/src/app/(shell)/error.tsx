"use client";

import { LoadFailed } from "@/components/state-views";

// A crash inside a screen replaces the screen, not the shell: the sidebar stays, so the owner can switch project or
// open Connections to recover. `app/error.tsx` is the fallback for a crash in the shell itself.
export default function ShellError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center p-6">
      <LoadFailed error={error} onRetry={reset} what="this screen" />
    </main>
  );
}
