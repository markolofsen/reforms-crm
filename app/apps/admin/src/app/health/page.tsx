import type { Metadata } from "next";
import { HealthPanel } from "@/features/health/health-panel";

export const metadata: Metadata = { title: "Health" };

// The server's own facts, outside the shell and off the nav (P70: the core block moved to Settings ▸ This Mac).
export default function HealthPage() {
  return (
    <main className="mx-auto grid measure gap-4 p-6">
      <h1 className="font-semibold text-xl">Admin health</h1>
      <HealthPanel />
    </main>
  );
}
