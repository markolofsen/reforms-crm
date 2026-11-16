"use client";

import { LoadFailed } from "@/components/state-views";

// The explicit error state of rules `state-and-data` 5: names the cause and offers a retry (re-renders the route).
export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md items-center justify-center p-6">
      <LoadFailed error={error} onRetry={reset} what="this page" />
    </main>
  );
}
