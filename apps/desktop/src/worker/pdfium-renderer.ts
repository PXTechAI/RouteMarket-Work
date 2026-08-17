import { readFile } from "node:fs/promises";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { PNG } from "pngjs";
import { WorkerError } from "@routemarket/work-worker-core";
import { calculatePdfRenderSize } from "./pdf-preview-limits";

const MAX_PDF_PAGES = 10_000;
const PDF_BITMAP_BGRA = 4;
const PDF_RENDER_FLAGS = 0;
const PDF_ERROR_PASSWORD = 4;

export type RenderedPdfPage = {
  pageCount: number;
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};

export async function renderPdfBufferPage(
  source: Uint8Array,
  requestedPageNumber: number,
  pdfium: WrappedPdfiumModule
): Promise<RenderedPdfPage> {
  const runtime = pdfium.pdfium as typeof pdfium.pdfium & {
    HEAPU8: Uint8Array;
    wasmExports: { malloc(size: number): number; free(pointer: number): void };
  };
  const sourcePointer = runtime.wasmExports.malloc(source.byteLength);
  if (!sourcePointer) throw new WorkerError("PDF_PREVIEW_MEMORY", "Could not allocate PDF preview memory.");
  runtime.HEAPU8.set(source, sourcePointer);

  let documentPointer = 0;
  let pagePointer = 0;
  let bitmapPointer = 0;
  let bitmapBufferPointer = 0;
  try {
    documentPointer = pdfium.FPDF_LoadMemDocument64(sourcePointer, source.byteLength, "");
    if (!documentPointer) {
      const errorCode = pdfium.FPDF_GetLastError();
      throw new WorkerError(
        errorCode === PDF_ERROR_PASSWORD ? "PDF_PREVIEW_PASSWORD_REQUIRED" : "PDF_PREVIEW_INVALID",
        errorCode === PDF_ERROR_PASSWORD
          ? "Password-protected PDFs cannot be previewed yet."
          : "PDFium could not open this PDF document."
      );
    }
    const pageCount = pdfium.FPDF_GetPageCount(documentPointer);
    if (pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new WorkerError("PDF_PREVIEW_PAGE_LIMIT", `PDF preview supports 1-${MAX_PDF_PAGES} pages.`);
    }
    const pageNumber = normalizePageNumber(requestedPageNumber, pageCount);
    pagePointer = pdfium.FPDF_LoadPage(documentPointer, pageNumber - 1);
    if (!pagePointer) throw new WorkerError("PDF_PREVIEW_PAGE_INVALID", "PDFium could not load this page.");

    const { width, height } = calculatePdfRenderSize(
      pdfium.FPDF_GetPageWidthF(pagePointer),
      pdfium.FPDF_GetPageHeightF(pagePointer)
    );
    const stride = width * 4;
    bitmapBufferPointer = runtime.wasmExports.malloc(stride * height);
    if (!bitmapBufferPointer) throw new WorkerError("PDF_PREVIEW_MEMORY", "Could not allocate page preview memory.");
    bitmapPointer = pdfium.FPDFBitmap_CreateEx(width, height, PDF_BITMAP_BGRA, bitmapBufferPointer, stride);
    if (!bitmapPointer) throw new WorkerError("PDF_PREVIEW_BITMAP", "Could not create the PDF preview bitmap.");
    pdfium.FPDFBitmap_FillRect(bitmapPointer, 0, 0, width, height, 0xffffffff);
    pdfium.FPDF_RenderPageBitmap(bitmapPointer, pagePointer, 0, 0, width, height, 0, PDF_RENDER_FLAGS);

    const bgra = runtime.HEAPU8.subarray(bitmapBufferPointer, bitmapBufferPointer + stride * height);
    const png = new PNG({ width, height });
    for (let index = 0; index < bgra.length; index += 4) {
      png.data[index] = bgra[index + 2]!;
      png.data[index + 1] = bgra[index + 1]!;
      png.data[index + 2] = bgra[index]!;
      png.data[index + 3] = bgra[index + 3]!;
    }
    const encoded = PNG.sync.write(png);
    return { pageCount, pageNumber, width, height, dataUrl: `data:image/png;base64,${encoded.toString("base64")}` };
  } finally {
    if (bitmapPointer) pdfium.FPDFBitmap_Destroy(bitmapPointer);
    if (bitmapBufferPointer) runtime.wasmExports.free(bitmapBufferPointer);
    if (pagePointer) pdfium.FPDF_ClosePage(pagePointer);
    if (documentPointer) pdfium.FPDF_CloseDocument(documentPointer);
    runtime.wasmExports.free(sourcePointer);
  }
}

export async function initializePdfium(wasmPath: string): Promise<WrappedPdfiumModule> {
  const wasmBinary = await readFile(wasmPath);
  const module = await init({ wasmBinary });
  module.PDFiumExt_Init();
  return module;
}

function normalizePageNumber(value: number, pageCount: number): number {
  if (!Number.isSafeInteger(value)) return 1;
  return Math.min(pageCount, Math.max(1, value));
}
