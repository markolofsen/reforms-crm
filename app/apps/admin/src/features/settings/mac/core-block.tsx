"use client";

import { useState } from "react";
import { QueryView } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { useCheckCore, useCore } from "@/lib/data/instance";
import { CoreView } from "./core-view";

/**
 * P68: the core update notice, on Settings ▸ This Mac since P70 (the update is done on this Mac). Check now asks the server for
 * one check (at most once a minute; the server says so) and puts its answer in the cache itself (the check bumps no live topic).
 */
export function CoreBlock() {
  const now = useClock()();
  const q = useCore();
  const [said, setSaid] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const check = useCheckCore({
    onMutate: () => setSaid({ text: "Checking the core's origin...", kind: "status" }),
    onSuccess: (d) => setSaid(d.error ? { text: `The origin did not answer: ${d.error.message}`, kind: "alert" } : { text: "Checked.", kind: "status" }),
    onError: (e) => setSaid({ text: `Not checked: ${sentence(e)}`, kind: "alert" }),
  });
  return (
    <QueryView query={q} what="the core update check">
      {(d) => <CoreView checking={check.isPending} d={d} now={now} onCheck={() => check.mutate()} said={said} />}
    </QueryView>
  );
}
