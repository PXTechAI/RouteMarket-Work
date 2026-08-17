import { readFile, stat } from "node:fs/promises";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import pdfiumWasmPath from "@embedpdf/pdfium/pdfium.wasm?asset";
import { WorkerError } from "@routemarket/work-worker-core";
import { initializePdfium, renderPdfBufferPage } from "./pdfium-renderer";

const MAX_PDF_BYTES = 32 * 1024 * 1024;

export type IsolatedPdfPagePreview = {
  pageCount: number;
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
  bytesRead: number;
};

let pdfiumPromise: Promise<WrappedPdfiumModule> | undefined;

export async function renderIsolatedPdfPage(
  filePath: string,
  requestedPageNumber = 1
): Promise<IsolatedPdfPagePreview> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new WorkerError("PROJECT_FILE_NOT_FOUND", "Requested PDF is not a file.");
  }
  if (fileStat.size <= 0 || fileStat.size > MAX_PDF_BYTES) {
    throw new WorkerError(
      "PDF_PREVIEW_SIZE_LIMIT",
      `PDF preview supports files up to ${MAX_PDF_BYTES / 1024 / 1024} MB.`
    );
  }
  const source = await readFile(filePath);
  if (!source.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new WorkerError("PDF_PREVIEW_INVALID", "The selected file is not a valid PDF document.");
  }
  pdfiumPromise ??= initializePdfium(pdfiumWasmPath);
  const rendered = await renderPdfBufferPage(source, requestedPageNumber, await pdfiumPromise);
  return { ...rendered, bytesRead: fileStat.size };
}
