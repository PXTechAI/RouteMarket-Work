import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendMonitorWorkbook,
  saveMonitorScreenshot,
  sendMonitorWorkbookWithQqMail,
} from "./workflow-monitor-actions";

const record = {
  productTitle: "Belkin USB-C Charger",
  priceText: "$24.99",
  priceValue: 24.99,
  currency: "USD",
  sourceUrl: "https://www.amazon.com/dp/B0F6431LKG",
  capturedAt: "2026-08-19T10:20:30.000Z",
};

describe("Workflow monitor actions", () => {
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("saves the managed-browser PNG inside the project", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-monitor-"));
    const browser = {
      screenshot: vi.fn(async () => "data:image/png;base64,iVBORw0KGgo="),
    };
    const workerClient = {
      projectRoot: vi.fn(async () => temporaryDirectory!),
    };
    const result = await saveMonitorScreenshot({
      browser: browser as never,
      workerClient: workerClient as never,
      localProjectId: "project_1",
      screenshotsDirectory: "outputs/screenshots",
      record,
    });

    expect(result.screenshotPath).toBe("outputs/screenshots/amazon-price-2026-08-19T10-20-30-000Z.png");
    expect(await readFile(join(temporaryDirectory, result.screenshotPath))).toEqual(
      Buffer.from("iVBORw0KGgo=", "base64"),
    );
  });

  it("creates the workbook once and appends later observations to the same file", async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "PROJECT_FILE_NOT_FOUND" }))
      .mockResolvedValueOnce({ rowCount: 2, sha256: "sha256:old" });
    const create = vi.fn(async () => ({
      uri: "project://project_1/outputs/price.xlsx",
      sha256: "sha256:first",
    }));
    const write = vi.fn(async () => ({
      uri: "project://project_1/outputs/price.xlsx",
      sha256: "sha256:second",
    }));
    const workerClient = {
      inspectProjectSpreadsheet: inspect,
      createProjectSpreadsheet: create,
      writeProjectSpreadsheetRange: write,
    };

    const first = await appendMonitorWorkbook({
      workerClient: workerClient as never,
      localProjectId: "project_1",
      workbookPath: "outputs/price.xlsx",
      record,
      screenshotPath: "outputs/shot.png",
    });
    const second = await appendMonitorWorkbook({
      workerClient: workerClient as never,
      localProjectId: "project_1",
      workbookPath: "outputs/price.xlsx",
      record,
      screenshotPath: "outputs/shot-2.png",
    });

    expect(first.workbookRow).toBe(2);
    expect(second.workbookRow).toBe(3);
    expect(create).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: "outputs/price.xlsx",
        range: "A3",
        expectedSha256: "sha256:old",
      }),
    );
  });

  it("hands QQ Mail login to the user and marks the workflow as waiting", async () => {
    const browser = qqMailBrowser({
      url: "https://mail.qq.com/",
      text: "QQ邮箱登录 密码登录",
      elements: [{ inputType: "password", role: "textbox", name: "密码" }],
    });

    await expect(
      sendMonitorWorkbookWithQqMail({
        browser: browser as never,
        localProjectId: "project_1",
        recipient: "lizhug.steven@gmail.com",
        subject: "Price update",
        body: "Attached",
        workbookPath: "outputs/price.xlsx",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_USER_ACTION_REQUIRED",
      message: expect.stringContaining("QQ 邮箱需要登录"),
    });
    expect(browser.setUserTakeover).toHaveBeenCalledWith("project_1", true, undefined, { source: "workflow" });
  });

  it("composes, attaches, and sends through an authenticated QQ Mail page", async () => {
    const elements = [
      domElement("recipient", "input", "combobox", "收件人", "input[aria-label='收件人']", "text"),
      domElement("subject", "input", "textbox", "主题", "input[aria-label='主题']", "text"),
      domElement("body", "div", "textbox", "邮件正文", "div[contenteditable='true']", null),
      domElement("send", "button", "button", "发送", "button[data-action='send']", null),
    ];
    const browser = qqMailBrowser({
      url: "https://mail.qq.com/",
      text: "写信",
      elements,
    });

    const result = await sendMonitorWorkbookWithQqMail({
      browser: browser as never,
      localProjectId: "project_1",
      recipient: "lizhug.steven@gmail.com",
      subject: "Price update",
      body: "Attached",
      workbookPath: "outputs/price.xlsx",
    });

    expect(result.sent).toBe(true);
    expect(browser.typeRef).toHaveBeenCalledWith("project_1", "recipient", "lizhug.steven@gmail.com", undefined, {
      source: "workflow",
    });
    expect(browser.upload).toHaveBeenCalledWith("project_1", "input[type='file']", ["outputs/price.xlsx"], undefined, {
      source: "workflow",
    });
    expect(browser.clickRef).toHaveBeenCalledWith("project_1", "send", undefined, { source: "workflow" });
  });
});

function qqMailBrowser(inspection: {
  url: string;
  text: string;
  elements: Array<Partial<ReturnType<typeof domElement>>>;
}) {
  return {
    getPageState: vi.fn(async () => ({ url: inspection.url, userTakeover: false })),
    inspect: vi.fn(async () => ({
      pageId: "page_1",
      title: "QQ邮箱",
      truncated: false,
      ...inspection,
      elements: inspection.elements.map((element, index) => ({
        ...domElement(`element_${index}`, "div", "", "", `#element-${index}`, null),
        ...element,
      })),
    })),
    navigate: vi.fn(),
    waitFor: vi.fn(),
    setUserTakeover: vi.fn(),
    clickRef: vi.fn(),
    type: vi.fn(),
    typeRef: vi.fn(),
    press: vi.fn(),
    upload: vi.fn(),
    screenshot: vi.fn(),
  };
}

function domElement(
  refId: string,
  tag: string,
  role: string,
  name: string,
  selector: string,
  inputType: string | null,
) {
  return {
    index: 0,
    refId,
    tag,
    role,
    name,
    text: "",
    selector,
    locator: selector,
    context: "document" as const,
    inputType,
    href: null,
    disabled: false,
    checked: null,
    x: 0,
    y: 0,
    centerX: 0,
    centerY: 0,
    width: 100,
    height: 20,
  };
}
