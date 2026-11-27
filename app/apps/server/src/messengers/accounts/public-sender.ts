import type { PublicReplySender } from "@hub/messengers";

/** Account activity tracking belongs to the account supervisor, not to the Watch ingestion port. */
export function trackedPublicSender(sender: PublicReplySender | undefined, activity: { busy: number }): PublicReplySender | null {
  if (!sender) return null;
  const track = async <T>(call: () => Promise<T>): Promise<T> => {
    activity.busy += 1;
    try { return await call(); } finally { activity.busy -= 1; }
  };
  const prepare = sender.preparePhoto;
  const preparePhoto: PublicReplySender["preparePhoto"] = prepare ? (authorization, bytes) => track(() => prepare.call(sender, authorization, bytes)) : undefined;
  return {
    ...(preparePhoto ? { preparePhoto } : {}),
    inspect: (target, id) => track(() => sender.inspect(target, id)),
    receipt: (target, id) => track(() => sender.receipt(target, id)),
    send: (authorization) => track(() => sender.send(authorization)),
  };
}

/** A parked, starting, errored or stopped connection grants no public send capability. */
export function runningPublicSender(slot: { st: { state: string }; publicSender: PublicReplySender | null } | undefined): PublicReplySender | undefined {
  return slot?.st.state === "running" ? slot.publicSender ?? undefined : undefined;
}
