"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadFailed, Loading } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { CoreView } from "./core-view";

/**
 * P68: the core update notice on `/health`. Check now asks the server for one check (at most once a minute; the server says
 * so) and puts its answer in the cache itself, since this page sits outside the shell and its live stream.
 */
export function CoreBlock() {
  const qc = useQueryClient();
  const now = useClock()();
  const q = useQuery({ queryKey: keys.core(), queryFn: metaApi.core, retry: false });
  const [said, setSaid] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const check = useMutation({
    mutationFn: metaApi.checkCore,
    onMutate: () => setSaid({ text: "Checking the core's origin...", kind: "status" }),
    onSuccess: (d) => {
      qc.setQueryData(keys.core(), d);
      setSaid(d.error ? { text: `The origin did not answer: ${d.error.message}`, kind: "alert" } : { text: "Checked.", kind: "status" });
    },
    onError: (e) => setSaid({ text: `Not checked: ${sentence(e)}`, kind: "alert" }),
  });
  if (q.isPending) return <Loading what="the core update check" />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the core update check" />;
  return <CoreView checking={check.isPending} d={q.data} now={now} onCheck={() => check.mutate()} said={said} />;
}
