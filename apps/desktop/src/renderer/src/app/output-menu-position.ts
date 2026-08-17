export type OutputMenuPlacement = {
  top?: number;
  bottom?: number;
  right: number;
  maxHeight: number;
  side: "top" | "bottom";
};

type AnchorRect = Pick<DOMRect, "top" | "right" | "bottom">;

export function calculateOutputMenuPlacement(
  anchor: AnchorRect,
  viewportWidth: number,
  viewportHeight: number,
  measuredHeight = 600,
  menuWidth = 320,
  gap = 8,
  margin = 12
): OutputMenuPlacement {
  const below = Math.max(0, viewportHeight - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const useBottom = below >= Math.min(measuredHeight, 280) || below >= above;
  const right = Math.max(margin, Math.min(viewportWidth - menuWidth - margin, viewportWidth - anchor.right));
  if (useBottom) {
    return {
      top: anchor.bottom + gap,
      right,
      maxHeight: Math.max(160, below),
      side: "bottom"
    };
  }
  return {
    bottom: viewportHeight - anchor.top + gap,
    right,
    maxHeight: Math.max(160, above),
    side: "top"
  };
}
