import type { ReactNode } from "react";
import { ShellFrame } from "@/features/shell/shell-frame";
import { instanceName } from "@/app/instance-name";

// P133 (P128 X8): the instance's name is read on the server, so the brand and its monogram are right on the first paint
// (before, "Hub" until the instance read answered).
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <ShellFrame instanceName={instanceName()}>{children}</ShellFrame>;
}
