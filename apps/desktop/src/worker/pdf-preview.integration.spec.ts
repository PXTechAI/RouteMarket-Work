import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { initializePdfium, renderPdfBufferPage } from "./pdfium-renderer";

const require = createRequire(import.meta.url);
const PDFIUM_WASM = require.resolve("@embedpdf/pdfium/pdfium.wasm");

describe("PDFium preview integration", () => {
  it("renders a real PDF page into a bounded PNG data URL", async () => {
    const source = createOnePagePdf();
    const module = await initializePdfium(PDFIUM_WASM);
    const rendered = await renderPdfBufferPage(source, 1, module);
    expect(rendered).toMatchObject({ pageCount: 1, pageNumber: 1 });
    expect(rendered.width * rendered.height).toBeLessThanOrEqual(4_000_000);
    const png = Buffer.from(rendered.dataUrl.slice("data:image/png;base64,".length), "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const qaOutput = process.env.ROUTEMARKET_PDF_QA_OUTPUT;
    if (qaOutput) {
      await mkdir(dirname(qaOutput), { recursive: true });
      await writeFile(qaOutput, png);
    }
  });
});

function createOnePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length 44 >>\nstream\nBT /F1 20 Tf 36 100 Td (RouteMarket PDF) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}
