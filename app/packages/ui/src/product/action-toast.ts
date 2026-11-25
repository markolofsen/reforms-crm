import { toastManager } from "../ui/toast";

type ToastOptions = Omit<Parameters<typeof toastManager.add>[0], "actionProps">;

/**
 * A toast with one action (Undo, Hide again, Unlink again: `ui-specifications.md` rule 5d). The action runs once and closes its
 * toast, so a spent Undo is never offered again (a second click would undo twice). Base UI's `Toast.Action` runs the action and
 * leaves the toast up, and the coss copy is not hand-edited, so every toast with an action is added here (the admin's lint
 * bans `actionProps` anywhere else).
 */
export function actionToast(o: ToastOptions & { action: { label: string; run: () => void } }): string {
  const { action, ...rest } = o;
  const id: string = toastManager.add({
    ...rest,
    actionProps: {
      children: action.label,
      onClick: () => {
        toastManager.close(id);
        action.run();
      },
    },
  });
  return id;
}
