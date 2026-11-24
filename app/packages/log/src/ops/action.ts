import { AsyncLocalStorage } from "node:async_hooks";
import { ACTION_ENV, isActionId } from "@hub/config/action-id";

// P137 L1: the action a line belongs to. The server runs each request inside `withAction` (its `x-hub-action`, or a fresh id),
// `hub mcp` each tool call (the session's `HUB_ACTION` and the call's id), a timer each pass; every ops line written inside,
// however deep (the Notion client, the Mail writer, the send door), carries it as the line's `action`. Outside any, a process
// started with `HUB_ACTION` (a session's hooks, `hub mcp`) uses that.

const store = new AsyncLocalStorage<string>();

/** Runs `fn` as part of action `id` (an invalid id runs it with none). */
export function withAction<T>(id: string | null | undefined, fn: () => T): T {
  return isActionId(id) ? store.run(id, fn) : fn();
}

/** The action of the code running now: the innermost `withAction`, else this process's `HUB_ACTION`, else none. */
export function currentAction(): string | undefined {
  const id = store.getStore();
  if (id) return id;
  const env = process.env[ACTION_ENV];
  return isActionId(env) ? env : undefined;
}
