import { describe, expect, it } from "vite-plus/test";
import { threadListDragDestination, threadListDragScrollSpeed } from "./thread-list-drag-geometry";
import { threadOrderAfterMove } from "./threadOrder";

const rows = [
  { key: "remote:pinned", section: "pinned" as const, top: 0, height: 72 },
  { key: "local:a", section: "active" as const, top: 96, height: 72 },
  { key: "remote:b", section: "active" as const, top: 168, height: 96 },
  { key: "local:c", section: "active" as const, top: 264, height: 72 },
];
const source = rows[1]!;

describe("main-list thread dragging", () => {
  it("drops past multiple variable-height rows using environment-scoped identities", () => {
    const destination = threadListDragDestination(rows, source, 320);
    expect(destination).toEqual({ section: "active", targetId: "local:c", placement: "after" });
    expect(
      threadOrderAfterMove(["local:a", "remote:b", "local:c"], source.key, destination!),
    ).toEqual(["remote:b", "local:c", "local:a"]);
  });

  it("can move back up before a row", () => {
    const destination = threadListDragDestination(rows, rows[3]!, 100);
    expect(
      threadOrderAfterMove(["local:a", "remote:b", "local:c"], "local:c", destination!),
    ).toEqual(["local:c", "local:a", "remote:b"]);
  });

  it("does not reorder on the source, in a gap, outside the list, or into another section", () => {
    for (const y of [-1, 30, 80, 120, 400]) {
      expect(threadListDragDestination(rows, source, y)).toBeNull();
    }
  });

  it("keeps hidden threads in place when arranging a filtered list", () => {
    const destination = threadListDragDestination(rows, source, 320)!;
    expect(
      threadOrderAfterMove(["local:a", "hidden", "remote:b", "local:c"], source.key, destination),
    ).toEqual(["hidden", "remote:b", "local:c", "local:a"]);
  });

  it("scrolls only at the viewport edges and stops outside", () => {
    expect(threadListDragScrollSpeed(100, 100, 600)).toBe(-500);
    expect(threadListDragScrollSpeed(124, 100, 600)).toBe(-250);
    expect(threadListDragScrollSpeed(400, 100, 600)).toBe(0);
    expect(threadListDragScrollSpeed(676, 100, 600)).toBe(250);
    expect(threadListDragScrollSpeed(700, 100, 600)).toBe(500);
    expect(threadListDragScrollSpeed(99, 100, 600)).toBe(0);
    expect(threadListDragScrollSpeed(701, 100, 600)).toBe(0);
    expect(threadListDragScrollSpeed(100, 100, 0)).toBe(0);
  });
});
