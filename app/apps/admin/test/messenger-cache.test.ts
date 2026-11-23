import { describe, expect, it } from "vitest";
import { keys, messengerMutationKeys } from "../src/lib/cache/keys";

describe("Messenger mutation cache policy", () => {
  it("refreshes the list and only the selected conversation when an id is known", () => {
    expect(messengerMutationKeys("saas-support", 3)).toEqual([keys.messengerChatsOf("saas-support"), keys.messengerConversation("saas-support", 3)]);
  });

  it("does not invent a detail key for link operations without a persisted chat id", () => {
    expect(messengerMutationKeys("saas-support")).toEqual([keys.messengerChatsOf("saas-support")]);
  });
});
