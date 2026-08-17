import { WorkerError } from "@routemarket/work-worker-core";

const MAX_RENDER_PIXELS = 4_000_000;
const MAX_RENDER_DIMENSION = 2_048;
const DEFAULT_RENDER_SCALE = 1.5;

export function calculatePdfRenderSize(pageWidth: number, pageHeight: number): { width: number; height: number } {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    throw new WorkerError("PDF_PREVIEW_PAGE_INVALID", "The PDF page has invalid dimensions.");
  }
  const scale = Math.min(
    DEFAULT_RENDER_SCALE,
    MAX_RENDER_DIMENSION / pageWidth,
    MAX_RENDER_DIMENSION / pageHeight,
    Math.sqrt(MAX_RENDER_PIXELS / (pageWidth * pageHeight))
  );
  const width = Math.max(1, Math.floor(pageWidth * scale));
  const height = Math.max(1, Math.floor(pageHeight * scale));
  if (width * height > MAX_RENDER_PIXELS) {
    throw new WorkerError("PDF_PREVIEW_PIXEL_LIMIT", "The PDF page exceeds the preview pixel limit.");
  }
  return { width, height };
}
