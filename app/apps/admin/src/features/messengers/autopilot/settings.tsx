"use client";

import { useId } from "react";
import { AUTOPILOT_ACCOUNT_SHARE, AUTOPILOT_CHAT_SENDS_PER_DAY, AUTOPILOT_DISCLOSE, AUTOPILOT_DISCLOSE_LABELS, AUTOPILOT_INSTANCE_TURNS_PER_DAY, AUTOPILOT_MODE_LABELS, AUTOPILOT_MODES } from "@hub/config/autopilot";
import { MESSENGER_DAILY_CAP } from "@hub/config/chat-rules";
import { SettingSwitch } from "@hub/ui/product/field";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { cn } from "@hub/ui/cn";
import { Loading, QueryView } from "@/components/state-views";
import { sentence } from "@/lib/api/client";
import { useAutopilotInstance, useProjectAutopilot, useSetAutopilotInstance, useSetProjectAutopilot } from "@/lib/data/messengers";
import { formatTime } from "@/lib/format";
import { CHANNEL_LABEL } from "../labels";
import { autopilotLine } from "./chat-switch";

const LABEL = "text-sm";
const HINT = "text-muted-foreground text-xs";

/** Verdict 27: said once, as the connect form says its risk. */
export const AUTOPILOT_RISK =
  "Autopilot replies from your own Telegram and WhatsApp accounts, without your click, in the chats you switch on. It raises how much an unofficial client sends from them; its limits are below. You accept that risk by switching it on.";

/**
 * Settings ▸ Messengers ▸ Autopilot (P139 A5, verdict 4): the switch of this Mac with its risk sentence, the project's mode
 * (Off, Dry run, On) and its disclose choice as `ToggleGroup`s like Reply mode, what the last day came to, and the chats
 * switched on with their state. Stock UI kit only; every write spends its own single-use ticket (the owner's door).
 */
export function AutopilotSettings({ project }: { project: string }) {
  const inst = useAutopilotInstance();
  const q = useProjectAutopilot(project);
  const setInstance = useSetAutopilotInstance(project);
  const set = useSetProjectAutopilot(project);
  const ids = { inst: useId(), mode: useId(), disclose: useId() };
  return (
    <div className="flex flex-col gap-3" data-testid="autopilot-settings">
      <div className="flex items-start gap-2">
        <SettingSwitch checked={inst.data?.on ?? false} describedBy={`${ids.inst}-note`} disabled={!inst.data} error={setInstance.isError ? sentence(setInstance.error) : null} labelledBy={ids.inst} onChange={(on) => setInstance.mutate(on)} pending={setInstance.isPending} />
        <div className="flex flex-col gap-0.5">
          <span className={LABEL} id={ids.inst}>
            Autopilot on this Mac
          </span>
          <span className={cn("measure", HINT)} id={`${ids.inst}-note`}>
            {AUTOPILOT_RISK} Turning it off stops every turn at once.
          </span>
        </div>
      </div>
      <QueryView loading={<Loading what="the autopilot" />} query={q} what="the autopilot">
        {(p) => (
          <div className="flex flex-col gap-3 border-t pt-3">
            {p.error && (
              <p className="text-destructive-foreground text-sm" role="alert">
                The send policy cannot be read, so autopilot is off: {p.error}
              </p>
            )}
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className={LABEL} id={ids.mode}>
                Autopilot for this project
              </legend>
              <ToggleGroup aria-labelledby={ids.mode} onValueChange={(v) => { const m = AUTOPILOT_MODES.find((x) => x === v[0]); if (m && m !== p.mode) set.mutate({ kind: "mode", mode: m }); }} size="sm" value={[p.mode]} variant="outline">
                {AUTOPILOT_MODES.map((m) => (
                  <ToggleGroupItem className="min-h-(--control-s)" disabled={set.isPending} key={m} value={m}>
                    {AUTOPILOT_MODE_LABELS[m]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className={cn("measure", HINT)}>Dry run does everything but send: the reply waits, marked, for your Send.</span>
            </fieldset>
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className={LABEL} id={ids.disclose}>
                Say it is your assistant
              </legend>
              <ToggleGroup aria-labelledby={ids.disclose} onValueChange={(v) => { const d = AUTOPILOT_DISCLOSE.find((x) => x === v[0]); if (d && d !== p.disclose) set.mutate({ kind: "disclose", disclose: d }); }} size="sm" value={[p.disclose]} variant="outline">
                {AUTOPILOT_DISCLOSE.map((d) => (
                  <ToggleGroupItem className="min-h-(--control-s)" disabled={set.isPending} key={d} value={d}>
                    {AUTOPILOT_DISCLOSE_LABELS[d]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className={cn("measure", HINT)}>Once a day: the first autopilot message in a chat each day ends with a short line saying it is your assistant.</span>
            </fieldset>
            {set.isError && (
              <p className="text-destructive-foreground text-sm" role="alert">
                {sentence(set.error)}
              </p>
            )}
            <div className="flex flex-col gap-1 border-t pt-3" data-testid="autopilot-today">
              <span className={LABEL}>Last 24 hours</span>
              <span className={HINT}>
                {p.today.sent} sent · {p.today.handedBack} handed back · {p.today.refused} refused · {p.today.dryRun} would send
                {p.today.lastTurnAt ? ` · last turn ${formatTime(p.today.lastTurnAt)}` : " · no turn yet"}
              </span>
              {p.today.accounts.map((a) => (
                <span className={HINT} key={`${a.channel}|${a.account}`}>
                  {CHANNEL_LABEL[a.channel]} {a.account}: {a.used} of autopilot&apos;s {a.share} sends used
                </span>
              ))}
              <span className={cn("measure", HINT)}>
                Limits: {AUTOPILOT_ACCOUNT_SHARE} of an account&apos;s {MESSENGER_DAILY_CAP} sends a day, {AUTOPILOT_CHAT_SENDS_PER_DAY} per chat, {AUTOPILOT_INSTANCE_TURNS_PER_DAY} turns a day on this Mac. Switch a chat on in its conversation header or on its line under Linked chats.
              </span>
            </div>
            {p.chats.some((c) => c.listed) && (
              <ul aria-label="Chats on autopilot" className="flex flex-col gap-0.5 border-t pt-3">
                {p.chats
                  .filter((c) => c.listed)
                  .map((c) => (
                    <li className="text-sm" key={c.chat}>
                      {c.title ?? c.chatId} <span className={HINT}>· {CHANNEL_LABEL[c.channel]} · {autopilotLine(c)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </QueryView>
    </div>
  );
}
