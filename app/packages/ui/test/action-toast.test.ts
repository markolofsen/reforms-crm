import { beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn((_o: { actionProps?: { children: string; onClick: () => void } }) => "t1");
const close = vi.fn();
vi.mock("../src/ui/toast", () => ({ toastManager: { add: (o: { actionProps?: { children: string; onClick: () => void } }) => add(o), close: (id: string) => close(id) } }));
const { actionToast } = await import("../src/product/action-toast");

describe("actionToast (ui-specifications 5d)", () => {
  beforeEach(() => {
    add.mockClear();
    close.mockClear();
  });
  it("labels the action, runs it once on click and closes its own toast, so a spent Undo is not offered again", () => {
    const run = vi.fn();
    expect(actionToast({ title: "No reply needed: Rita", type: "success", action: { label: "Undo", run } })).toBe("t1");
    const props = add.mock.calls[0]?.[0].actionProps;
    expect(props?.children).toBe("Undo");
    props?.onClick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("t1");
  });
});
