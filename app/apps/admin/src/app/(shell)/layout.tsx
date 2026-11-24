import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { ShellFrame } from "@/features/shell/shell-frame";
import { instanceName } from "@/app/instance-name";
import { SHELL_COOKIE, parseShellPrefs } from "@/lib/shell-prefs";

// P133 (P128 X8): the instance's name is read on the server, so the brand and its monogram are right on the first paint
// (before, "Hub" until the instance read answered). So is the shell cookie (`lib/shell-prefs.ts`): the rail's pin, the
// terminal column's open state and width and the last breakpoint, so the first render is laid out as the last page ended.
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const shell = parseShellPrefs((await cookies()).get(SHELL_COOKIE)?.value);
  return (
    <ShellFrame instanceName={instanceName()} shell={shell}>
      {children}
    </ShellFrame>
  );
}
