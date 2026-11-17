import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BATCH_INTENTS, DEFAULT_SILENT_DAYS, INTENT_LABELS, type Audience, type BatchIntent } from "@hub/config";
import { Field } from "@hub/ui/product/field";
import { FilterChips } from "@hub/ui/product/filter-chips";
import { Alert, AlertDescription } from "@hub/ui/alert";
import { ActionButton } from "@hub/ui/product/action-button";
import { Input } from "@hub/ui/input";
import { AppLink } from "@/components/app-link";
import { Textarea } from "@hub/ui/textarea";
import { bulkApi } from "@/lib/api/bulk";
import { refreshData, sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { plural } from "@/lib/format";
import { useGo } from "@/hooks/use-go";
import { paths } from "@/routes/paths";
import { AudiencePicker } from "./audience-picker";

const INTENT_CHIPS = BATCH_INTENTS.map((i) => ({ value: i, label: INTENT_LABELS[i], count: null }));

/**
 * Step 1 who, step 2 what. Nothing is created until "Create batch", and nothing is ever sent: a batch is a brief (the
 * purpose and the tone) and a list of clients. The agent reads each client's thread and profile and writes that client's
 * own draft; one text is never copied to everyone (P28 C5). You review the drafts one by one.
 */
export function NewBatch({ project }: { project: string }) {
  const qc = useQueryClient();
  const go = useGo();
  const now = useClock()();
  const today = new Date(now).toISOString().slice(0, 10);
  const [audience, setAudience] = useState<Audience>("all");
  const [silentDays, setSilentDays] = useState(String(DEFAULT_SILENT_DAYS));
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [intent, setIntent] = useState<BatchIntent>("follow_up");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");

  const days = Math.min(3650, Math.max(1, Math.round(Number(silentDays)) || DEFAULT_SILENT_DAYS));
  const query = useQuery({ queryKey: ["audience", project, audience, days], queryFn: () => bulkApi.audience(project, audience, days), placeholderData: keepPreviousData });
  const clients = useMemo(() => query.data?.clients ?? [], [query.data]);
  const eligible = useMemo(() => clients.filter((c) => c.reason === null), [clients]);
  const selected = useMemo(() => eligible.filter((c) => !unticked.has(c.id)), [eligible, unticked]);

  const defaultName = `${INTENT_LABELS[intent]} ${today}`;
  const valid = selected.length > 0 && brief.trim() !== "";

  const create = useMutation({
    mutationFn: () =>
      bulkApi.create({
        project,
        name: name.trim() || defaultName,
        intent,
        audience,
        silentDays: audience === "silent" ? days : null,
        clientIds: selected.map((c) => c.id),
        brief,
      }),
    onSuccess: async ({ batchId }) => {
      await refreshData(qc);
      go(paths.bulk.item(batchId), { replace: true });
    },
  });

  const toggle = (id: number, on: boolean) =>
    setUnticked((cur) => {
      const next = new Set(cur);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <AppLink to={paths.bulk.list()}>All batches</AppLink>
        <h3 className="font-heading font-semibold text-base">New batch</h3>
      </div>

      <AudiencePicker
        audience={audience}
        clients={clients}
        data={query.data}
        days={days}
        eligible={eligible.length}
        error={query.isError ? query.error : null}
        loading={query.isPending}
        now={now}
        onAll={() => setUnticked(new Set())}
        onAudience={(a) => {
          setAudience(a);
          setUnticked(new Set());
        }}
        onNone={() => setUnticked(new Set(eligible.map((c) => c.id)))}
        onRetry={() => void query.refetch()}
        onSilentDays={setSilentDays}
        onToggle={toggle}
        selected={selected.length}
        silentDays={silentDays}
        unticked={unticked}
      />

      <section aria-labelledby="what" className="flex flex-col gap-3">
        <h3 className="font-medium text-sm" id="what">
          2. What
        </h3>
        <FilterChips chips={INTENT_CHIPS} label="Intent" onChange={setIntent} value={intent} />
        <Field htmlFor="batch-name" label="Batch name">
          <Input className="control-m" id="batch-name" onChange={(e) => setName(e.target.value)} placeholder={defaultName} value={name} />
        </Field>
        <Field hint="Say the purpose and the tone, not the words. For each client the agent reads the thread and the profile, then writes that client's own reply with the reason for it. Until it does, the batch shows Waiting for the agent." htmlFor="brief" label="What should the agent say, and how?">
          <Textarea className="min-h-28" id="brief" onChange={(e) => setBrief(e.target.value)} value={brief} />
        </Field>
        {selected.length > 0 && (
          <p className="text-muted-foreground text-sm" data-first={selected[0]?.name} data-testid="brief-preview">
            {plural(selected.length, "draft")}, one per person: {selected.slice(0, 3).map((c) => c.name).join(", ")}
            {selected.length > 3 ? `, and ${selected.length - 3} more` : ""}. Each is written for that person, never one text for all.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <ActionButton disabled={!valid || create.isPending} onClick={() => create.mutate()} size="s" variant="primary">
          Create batch
        </ActionButton>
        <span className="text-muted-foreground text-xs">
          {plural(selected.length, "draft")} will be written by the agent. Nothing goes out until you send each one.
        </span>
      </div>
      {create.isError && (
        <Alert variant="error">
          <AlertDescription>{sentence(create.error)}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
