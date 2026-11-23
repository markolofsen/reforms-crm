import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommitField, Field, SettingSwitch } from "@hub/ui/product/field";

/** One owner switch and one save-on-blur field (P127 B1, V10) in each state: idle, saving (disabled), and a failed save said under it. */
function SettingRows() {
  const [on, setOn] = useState(true);
  const [days, setDays] = useState("14");
  return (
    <div className="flex w-[360px] flex-col gap-4 border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <span id="follow-ups">Follow-ups</span>
        <SettingSwitch checked={on} id="follow-ups-switch" labelledBy="follow-ups" onChange={setOn} pending={false} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span id="advisor">Advisor (saving)</span>
        <SettingSwitch checked id="advisor-switch" labelledBy="advisor" onChange={() => undefined} pending />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span id="quiet">Quiet days (failed)</span>
        <SettingSwitch checked={false} error="Could not save: the server did not answer." id="quiet-switch" labelledBy="quiet" onChange={() => undefined} pending={false} />
      </div>
      <Field htmlFor="days" label="Days before a follow-up">
        <CommitField id="days" inputMode="numeric" key={days} onCommit={(v) => (/^\d+$/.test(v) ? setDays(v) : false)} pending={false} value={days} />
      </Field>
      <Field htmlFor="words" label="Words to avoid (saving)">
        <CommitField id="words" onCommit={() => undefined} pending value="cheap, urgent" />
      </Field>
      <Field htmlFor="cap" label="Daily cap (failed)">
        <CommitField error="Could not save: 0 is below the smallest cap." id="cap" inputMode="numeric" onCommit={() => undefined} pending={false} value="0" />
      </Field>
    </div>
  );
}

const meta = { title: "Product/Setting rows", component: SettingRows } satisfies Meta<typeof SettingRows>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
