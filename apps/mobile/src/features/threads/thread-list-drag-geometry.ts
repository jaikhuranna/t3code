export interface ThreadDragBounds {
  readonly key: string;
  readonly section: "pinned" | "active";
  readonly top: number;
  readonly height: number;
}

/** Hit testing uses untransformed row bounds, including variable-height cards. */
export function threadListDragDestination(
  rows: readonly ThreadDragBounds[],
  source: Pick<ThreadDragBounds, "key" | "section">,
  y: number,
) {
  const target = rows.find((row) => y >= row.top && y < row.top + row.height);
  if (!target || target.key === source.key || target.section !== source.section) return null;
  return {
    targetId: target.key,
    section: source.section,
    placement: y < target.top + target.height / 2 ? ("before" as const) : ("after" as const),
  };
}

export function threadListDragScrollSpeed(y: number, top: number, height: number) {
  const edge = Math.min(48, height / 3);
  if (y < top || y > top + height || edge <= 0) return 0;
  if (y < top + edge) return -500 * (1 - (y - top) / edge);
  if (y > top + height - edge) return 500 * (1 - (top + height - y) / edge);
  return 0;
}
