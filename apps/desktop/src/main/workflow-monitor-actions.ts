import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ManagedBrowserDomElement } from "../shared/desktop-api";
import type { ManagedBrowserManager } from "./managed-browser-manager";
import type { WorkerClient } from "./worker-client";
import type { ProductPriceRecord } from "./workflow-product-data";

const PRICE_HISTORY_HEADERS = [
  "Captured at",
  "Product",
  "Price text",
  "Price value",
  "Currency",
  "Source URL",
  "Screenshot",
] as const;

type BrowserForMonitor = Pick<
  ManagedBrowserManager,
  | "clickRef"
  | "getPageState"
  | "inspect"
  | "navigate"
  | "press"
  | "setUserTakeover"
  | "screenshot"
  | "type"
  | "typeRef"
  | "upload"
  | "waitFor"
>;

export async function saveMonitorScreenshot(input: {
  browser: Pick<ManagedBrowserManager, "screenshot">;
  workerClient: WorkerClient;
  localProjectId: string;
  pageId?: string;
  screenshotsDirectory: string;
  record: ProductPriceRecord;
}): Promise<
  ProductPriceRecord & {
    screenshotPath: string;
    screenshotUri: string;
  }
> {
  const directory = normalizeProjectRelativePath(input.screenshotsDirectory, "screenshotsDirectory");
  const stamp = input.record.capturedAt.replace(/[:.]/g, "-");
  const screenshotPath = `${directory.replace(/\/$/, "")}/amazon-price-${stamp}.png`;
  const dataUrl = await input.browser.screenshot(input.localProjectId, input.pageId, { source: "workflow" });
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Managed Browser returned an invalid PNG screenshot.");
  const projectRoot = await input.workerClient.projectRoot(input.localProjectId);
  const absolutePath = resolveInsideProject(projectRoot, screenshotPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(match[1]!, "base64"), { flag: "wx" });
  return {
    ...input.record,
    screenshotPath,
    screenshotUri: projectUri(input.localProjectId, screenshotPath),
  };
}

export async function appendMonitorWorkbook(input: {
  workerClient: WorkerClient;
  localProjectId: string;
  workbookPath: string;
  sheetName?: string;
  record: ProductPriceRecord;
  screenshotPath: string;
}): Promise<
  ProductPriceRecord & {
    screenshotPath: string;
    workbookPath: string;
    workbookUri: string;
    workbookRow: number;
    workbookSha256: string;
  }
> {
  const workbookPath = normalizeProjectRelativePath(input.workbookPath, "workbookPath");
  if (extname(workbookPath).toLowerCase() !== ".xlsx") {
    throw new Error("workbookPath must end with .xlsx.");
  }
  const sheetName = input.sheetName?.trim() || "Price History";
  const row = monitorRow(input.record, input.screenshotPath);
  let workbookRow: number;
  let workbookSha256: string;
  let workbookUri: string;
  try {
    const inspected = await input.workerClient.inspectProjectSpreadsheet({
      localProjectId: input.localProjectId,
      relativePath: workbookPath,
      sheetName,
    });
    workbookRow = Math.max(1, inspected.rowCount) + 1;
    const written = await input.workerClient.writeProjectSpreadsheetRange({
      localProjectId: input.localProjectId,
      relativePath: workbookPath,
      sheetName,
      range: `A${workbookRow}`,
      rows: [row],
      expectedSha256: inspected.sha256,
    });
    workbookSha256 = written.sha256;
    workbookUri = written.uri;
  } catch (error) {
    if (!hasErrorCode(error, "PROJECT_FILE_NOT_FOUND")) throw error;
    const created = await input.workerClient.createProjectSpreadsheet({
      localProjectId: input.localProjectId,
      relativePath: workbookPath,
      sheetName,
      rows: [[...PRICE_HISTORY_HEADERS], row],
      freezePane: "A2",
      columnWidths: [24, 48, 16, 14, 10, 54, 48],
    });
    workbookRow = 2;
    workbookSha256 = created.sha256;
    workbookUri = created.uri;
  }
  return {
    ...input.record,
    screenshotPath: input.screenshotPath,
    workbookPath,
    workbookUri,
    workbookRow,
    workbookSha256,
  };
}

export async function sendMonitorWorkbookWithQqMail(input: {
  browser: BrowserForMonitor;
  localProjectId: string;
  pageId?: string;
  recipient: string;
  subject: string;
  body: string;
  workbookPath: string;
}): Promise<{
  sent: true;
  recipient: string;
  workbookPath: string;
  sentAt: string;
}> {
  const state = await input.browser.getPageState(input.localProjectId, input.pageId);
  if (state.userTakeover) {
    throw userActionRequired("请在内置浏览器完成 QQ 邮箱登录或验证码，然后点击“交还 AI 控制”并继续工作流。");
  }
  if (!isQqMailUrl(state.url)) {
    await input.browser.navigate(input.localProjectId, "https://mail.qq.com/", input.pageId, { source: "workflow" });
    await input.browser.waitFor(input.localProjectId, "load", undefined, 30_000, input.pageId);
  }
  let inspection = await input.browser.inspect(input.localProjectId, input.pageId, 350);
  if (requiresQqMailLogin(inspection.elements, inspection.text)) {
    await input.browser.setUserTakeover(input.localProjectId, true, input.pageId, { source: "workflow" });
    throw userActionRequired(
      "QQ 邮箱需要登录或人工验证。请在内置浏览器接管并自行输入账号、密码或验证码；完成后交还 AI 控制并继续。登录会保留在持久化浏览器配置中。",
    );
  }

  if (!findElement(inspection.elements, isRecipientField)) {
    const compose = findElement(
      inspection.elements,
      (element) => element.role === "button" && matchesOne(element.name || element.text, ["compose", "写邮件", "写信"]),
    );
    if (!compose) throw new Error("Could not find QQ Mail's Compose button.");
    await input.browser.clickRef(input.localProjectId, compose.refId, input.pageId, { source: "workflow" });
    await input.browser.waitFor(input.localProjectId, "text", "收件人", 10_000, input.pageId);
    inspection = await input.browser.inspect(input.localProjectId, input.pageId, 350);
  }

  const recipient = findElement(inspection.elements, isRecipientField);
  const subject = findElement(inspection.elements, isSubjectField);
  const body = findElement(inspection.elements, isMessageBody);
  if (!recipient || !subject || !body) {
    throw new Error("Could not identify QQ Mail recipient, subject, or message body fields.");
  }
  await input.browser.typeRef(input.localProjectId, recipient.refId, input.recipient, input.pageId, {
    source: "workflow",
  });
  await input.browser.press(input.localProjectId, "Enter", [], input.pageId, { source: "workflow" });
  await input.browser.typeRef(input.localProjectId, subject.refId, input.subject, input.pageId, { source: "workflow" });
  await input.browser.typeRef(input.localProjectId, body.refId, input.body, input.pageId, { source: "workflow" });
  await input.browser.upload(input.localProjectId, "input[type='file']", [input.workbookPath], input.pageId, {
    source: "workflow",
  });
  const attachmentName = input.workbookPath.split("/").at(-1)!;
  await input.browser.waitFor(input.localProjectId, "text", attachmentName, 30_000, input.pageId);

  inspection = await input.browser.inspect(input.localProjectId, input.pageId, 350);
  const send = findElement(
    inspection.elements,
    (element) => element.role === "button" && matchesOne(element.name || element.text, ["send", "发送"]),
  );
  if (!send) throw new Error("Could not find QQ Mail's Send button.");
  await input.browser.clickRef(input.localProjectId, send.refId, input.pageId, { source: "workflow" });
  return {
    sent: true,
    recipient: input.recipient,
    workbookPath: input.workbookPath,
    sentAt: new Date().toISOString(),
  };
}

function monitorRow(record: ProductPriceRecord, screenshotPath: string) {
  return [
    record.capturedAt,
    record.productTitle,
    record.priceText,
    record.priceValue,
    record.currency,
    record.sourceUrl,
    screenshotPath,
  ];
}

function requiresQqMailLogin(elements: ManagedBrowserDomElement[], text: string): boolean {
  if (elements.some((element) => element.inputType?.toLowerCase() === "password")) return true;
  const hasCompose = elements.some(
    (element) => element.role === "button" && matchesOne(element.name || element.text, ["compose", "写邮件", "写信"]),
  );
  return !hasCompose && /qq邮箱登录|登录qq邮箱|扫码登录|密码登录|验证码/i.test(text);
}

function isQqMailUrl(url: string): boolean {
  return /^https:\/\/(?:[^/]+\.)?mail\.qq\.com(?:\/|$)/i.test(url);
}

function isSubjectField(element: ManagedBrowserDomElement): boolean {
  const label = `${element.name} ${element.text} ${element.selector}`.toLowerCase();
  return element.tag === "input" && !isRecipientField(element) && matchesOne(label, ["subject", "主题"]);
}

function isRecipientField(element: ManagedBrowserDomElement): boolean {
  const label = `${element.name} ${element.text}`.toLowerCase();
  return (
    (element.role === "combobox" || element.tag === "input") &&
    matchesOne(label, ["recipients", "recipient", "to", "收件人"]) &&
    !element.selector.includes("subjectbox")
  );
}

function isMessageBody(element: ManagedBrowserDomElement): boolean {
  const label = `${element.name} ${element.text}`.toLowerCase();
  return (
    element.role === "textbox" && element.tag !== "input" && matchesOne(label, ["message body", "邮件正文", "正文"])
  );
}

function findElement(
  elements: ManagedBrowserDomElement[],
  predicate: (element: ManagedBrowserDomElement) => boolean,
): ManagedBrowserDomElement | undefined {
  return elements.find((element) => !element.disabled && predicate(element));
}

function matchesOne(value: string, candidates: string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return candidates.some((candidate) => normalized === candidate || normalized.includes(candidate));
}

function normalizeProjectRelativePath(value: string, name: string): string {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || isAbsolute(path) || path.split("/").includes("..")) {
    throw new Error(`${name} must stay inside the project.`);
  }
  return path;
}

function resolveInsideProject(projectRoot: string, relativePath: string): string {
  const target = resolve(projectRoot, relativePath);
  const fromRoot = relative(resolve(projectRoot), target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Workflow artifact path escapes the project.");
  }
  return target;
}

function projectUri(projectId: string, path: string): string {
  return `project://${projectId}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

function userActionRequired(message: string): Error {
  return Object.assign(new Error(message), {
    code: "WORKFLOW_USER_ACTION_REQUIRED",
  });
}
