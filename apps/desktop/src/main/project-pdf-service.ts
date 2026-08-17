import { createHash, randomUUID } from "node:crypto";
import { link, lstat, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { BrowserWindow } from "electron";

const MAX_PDF_SOURCE_CHARACTERS = 500_000;
const MAX_PDF_BYTES = 64 * 1024 * 1024;

export type ProjectPdfResult = {
  relativePath: string;
  filename: string;
  mimeType: "application/pdf";
  bytes: number;
  sha256: string;
  uri: string;
  pageCount: number | null;
};

export class ProjectPdfService {
  constructor(private readonly resolveProjectRoot: (localProjectId: string) => Promise<string>) {}

  async create(input: {
    localProjectId: string;
    relativePath: string;
    title?: string;
    content: string;
  }): Promise<ProjectPdfResult> {
    const relativePath = validatePdfFilename(input.relativePath);
    if (!input.content.trim() || input.content.length > MAX_PDF_SOURCE_CHARACTERS || input.content.includes("\0")) {
      throw new Error(`content must contain between 1 and ${MAX_PDF_SOURCE_CHARACTERS} characters.`);
    }
    const root = await realpath(await this.resolveProjectRoot(input.localProjectId));
    const outputPath = join(root, relativePath);
    await assertNewRegularFile(outputPath);
    const temporaryPath = join(root, `.routemarket-pdf-${randomUUID()}.tmp`);
    const window = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      const html = renderPdfHtml(input.title?.trim() || basename(relativePath, extname(relativePath)), input.content);
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await window.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: '<div style="width:100%;padding:0 12mm;color:#8a94a8;font:9px system-ui;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margins: { top: 0.45, bottom: 0.55, left: 0.5, right: 0.5 },
        generateTaggedPDF: true,
        generateDocumentOutline: true
      });
      if (!pdf.length || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("The native PDF renderer returned an invalid document.");
      }
      await writeFile(temporaryPath, pdf, { flag: "wx", mode: 0o600 });
      await link(temporaryPath, outputPath);
      const digest = createHash("sha256").update(pdf).digest("hex");
      return {
        relativePath,
        filename: relativePath,
        mimeType: "application/pdf",
        bytes: pdf.length,
        sha256: `sha256:${digest}`,
        uri: `project://${input.localProjectId}/${encodeURIComponent(relativePath)}`,
        pageCount: countPdfPages(pdf)
      };
    } finally {
      window.destroy();
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export function renderPdfHtml(title: string, markdown: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: A4; margin: 17mm 18mm 19mm; }
* { box-sizing: border-box; }
html { color: #182033; background: #fff; font-family: "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif; }
body { margin: 0; font-size: 11pt; line-height: 1.75; overflow-wrap: anywhere; }
h1, h2, h3, h4 { color: #10172a; line-height: 1.35; break-after: avoid; }
h1 { margin: 0 0 12mm; font-size: 24pt; letter-spacing: -.02em; }
h2 { margin: 8mm 0 3mm; padding-bottom: 2mm; border-bottom: 1px solid #e4e8f0; font-size: 17pt; }
h3 { margin: 6mm 0 2mm; font-size: 13.5pt; }
h4 { margin: 5mm 0 2mm; font-size: 11.5pt; }
p { margin: 0 0 3.5mm; orphans: 3; widows: 3; }
ul, ol { margin: 1mm 0 4mm; padding-left: 7mm; }
li { margin: 1.2mm 0; }
blockquote { margin: 4mm 0; padding: 2.5mm 4mm; color: #536079; background: #f5f7fb; border-left: 3px solid #8796ff; }
code { padding: .2em .35em; color: #37415a; background: #f0f2f7; border-radius: 3px; font: .9em Consolas, monospace; }
hr { margin: 7mm 0; border: 0; border-top: 1px solid #dfe4ed; }
strong { color: #0f172a; font-weight: 700; }
</style></head><body><main><h1>${inlineMarkdown(title)}</h1>${markdownToHtml(markdown)}</main></body></html>`;
}

function markdownToHtml(markdown: string): string {
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };
  for (const rawLine of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    if (/^---+$/.test(line)) { closeList(); output.push("<hr>"); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { closeList(); const level = heading[1]!.length; output.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`); continue; }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const nextList = unordered ? "ul" : "ol";
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${inlineMarkdown((unordered ?? ordered)![1]!)}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith("> ")) output.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
    else output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("\n");
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function validatePdfFilename(value: string): string {
  const path = value.trim();
  if (!path || path.length > 180 || path.includes("\0") || path.includes("/") || path.includes("\\") || path === "." || path === "..") {
    throw new Error("path must be a PDF filename in the current project root.");
  }
  if (extname(path).toLocaleLowerCase() !== ".pdf") throw new Error("path must end with .pdf.");
  return path;
}

async function assertNewRegularFile(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new Error("The PDF output path is a symbolic link.");
    throw new Error("The PDF output file already exists. Choose a new filename.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function countPdfPages(pdf: Buffer): number | null {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g);
  return matches?.length || null;
}
