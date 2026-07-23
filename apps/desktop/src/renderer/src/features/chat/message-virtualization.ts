export const MESSAGE_VIRTUALIZATION_THRESHOLD = 40;
export const DEFAULT_MESSAGE_HEIGHT = 180;
export const MESSAGE_GAP = 14;
export const MESSAGE_LIST_PADDING_TOP = 28;
export const MESSAGE_LIST_PADDING_BOTTOM = 54;
export const MESSAGE_OVERSCAN = 700;

export type VirtualMessageLayout = {
  offsets: number[];
  heights: number[];
  totalHeight: number;
};

export type VirtualMessageRange = {
  start: number;
  end: number;
};

export function buildVirtualMessageLayout(
  ids: string[],
  measuredHeights: ReadonlyMap<string, number>,
  estimatedHeight = DEFAULT_MESSAGE_HEIGHT,
  gap = MESSAGE_GAP
): VirtualMessageLayout {
  const offsets: number[] = [];
  const heights: number[] = [];
  let offset = MESSAGE_LIST_PADDING_TOP;
  for (const id of ids) {
    const measured = measuredHeights.get(id);
    const height =
      measured && Number.isFinite(measured) && measured > 0
        ? measured
        : estimatedHeight;
    offsets.push(offset);
    heights.push(height);
    offset += height + gap;
  }
  const trailingGap = ids.length ? gap : 0;
  return {
    offsets,
    heights,
    totalHeight:
      offset - trailingGap + MESSAGE_LIST_PADDING_BOTTOM
  };
}

export function visibleVirtualMessageRange(
  layout: VirtualMessageLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = MESSAGE_OVERSCAN
): VirtualMessageRange {
  if (!layout.offsets.length) return { start: 0, end: 0 };
  const visibleStart = Math.max(0, scrollTop - overscan);
  const visibleEnd = scrollTop + Math.max(0, viewportHeight) + overscan;
  let low = 0;
  let high = layout.offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const bottom = layout.offsets[middle]! + layout.heights[middle]!;
    if (bottom < visibleStart) low = middle + 1;
    else high = middle;
  }
  const start = Math.min(low, layout.offsets.length - 1);
  let end = start;
  while (
    end < layout.offsets.length &&
    layout.offsets[end]! <= visibleEnd
  ) {
    end += 1;
  }
  return { start, end: Math.max(start + 1, end) };
}
