import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportProductPriceCsv,
  extractProductPrice,
  extractVisibleProductPrice
} from "./workflow-product-data";

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = null;
});

describe("workflow product data", () => {
  it("falls back across Amazon layouts and normalizes the product price", async () => {
    const extract = vi.fn(async (
      _localProjectId: string,
      selector: string
    ) => {
      if (selector === "#productTitle") return "  Test   Product  ";
      if (selector === ".priceToPay .a-offscreen") return " $1,299.99 ";
      throw new Error("Browser element not found");
    });

    await expect(
      extractProductPrice(
        { extract } as never,
        {
          localProjectId: "project_1",
          sourceUrl: "https://www.amazon.com/dp/test"
        }
      )
    ).resolves.toMatchObject({
      productTitle: "Test Product",
      priceText: "$1,299.99",
      priceValue: 1299.99,
      currency: "USD"
    });
    expect(extract).toHaveBeenCalledWith(
      "project_1",
      ".priceToPay .a-offscreen",
      undefined,
      { source: "workflow" }
    );
  });

  it("reports an extraction error without requesting takeover when a normal page has no price", async () => {
    const extract = vi.fn(async (_localProjectId: string, selector: string) => {
      if (selector === "#productTitle") return "Belkin USB C Charger";
      throw new Error("Browser element not found");
    });
    const setUserTakeover = vi.fn(async () => ({}));

    await expect(
      extractProductPrice(
        { extract, setUserTakeover } as never,
        {
          localProjectId: "project_1",
          sourceUrl: "https://www.amazon.com/dp/test"
        }
      )
    ).rejects.toMatchObject({
      code: "WORKFLOW_PRODUCT_DATA_UNAVAILABLE",
      message: expect.stringContaining("未能识别价格")
    });
    expect(setUserTakeover).not.toHaveBeenCalled();
  });

  it("extracts the selected Amazon variant price", async () => {
    const extract = vi.fn(async (_localProjectId: string, selector: string) => {
      if (selector === "#productTitle") return "Belkin USB C Charger";
      if (selector === "#inline-twister-expanded-dimension-text-price") return "CNY 125.19";
      throw new Error("Browser element not found");
    });

    await expect(
      extractProductPrice(
        { extract } as never,
        { localProjectId: "project_1", sourceUrl: "https://www.amazon.com/dp/test" },
      ),
    ).resolves.toMatchObject({
      priceText: "CNY 125.19",
      priceValue: 125.19,
      currency: "CNY",
    });
  });

  it("falls back to the visible selected-variant price in page text", async () => {
    const extract = vi.fn(async (_localProjectId: string, selector: string) => {
      if (selector === "#productTitle") return "Belkin USB C Charger";
      throw new Error("Browser element not found");
    });
    const inspect = vi.fn(async () => ({
      title: "Belkin USB C Charger",
      text: "颜色：黑色\n16个选项，起始价：CNY 125.19\n品牌 Belkin",
      elements: [],
    }));

    await expect(
      extractProductPrice(
        { extract, inspect } as never,
        { localProjectId: "project_1", sourceUrl: "https://www.amazon.com/dp/test" },
      ),
    ).resolves.toMatchObject({ priceText: "CNY 125.19", priceValue: 125.19, currency: "CNY" });
    expect(extractVisibleProductPrice("起始价：CNY 125.19", "https://www.amazon.com/dp/test"))
      .toBe("CNY 125.19");
  });

  it("recognizes Amazon's continue-shopping anti-bot page and requests takeover", async () => {
    const extract = vi.fn(async () => {
      throw new Error("Browser element not found");
    });
    const setUserTakeover = vi.fn(async () => ({}));
    const inspect = vi.fn(async () => ({
      title: "Amazon.com",
      text: "Click the button below to continue shopping",
      elements: [{ inputType: null, name: "Continue shopping", text: "Continue shopping" }],
    }));

    await expect(
      extractProductPrice(
        {
          extract,
          inspect,
          setUserTakeover,
          getPageState: vi.fn(async () => ({
            userTakeover: false,
            url: "https://www.amazon.com/errors_page/validateCaptcha",
          })),
        } as never,
        {
          localProjectId: "project_1",
          sourceUrl: "https://www.amazon.com/dp/test",
        },
      ),
    ).rejects.toMatchObject({
      code: "WORKFLOW_USER_ACTION_REQUIRED",
      message: expect.stringContaining("人工验证"),
    });
    expect(setUserTakeover).toHaveBeenCalledWith("project_1", true, undefined, { source: "workflow" });
  });

  it("writes an Excel-compatible CSV without overwriting an existing export", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "routemarket-price-"));
    const record = {
      productTitle: 'Demo "Product"',
      priceText: "$12.99",
      priceValue: 12.99,
      currency: "USD",
      sourceUrl: "https://www.amazon.com/dp/test",
      capturedAt: "2026-07-24T00:00:00.000Z"
    };
    const first = await exportProductPriceCsv({
      outputDirectory: temporaryDirectory,
      fileName: "price.csv",
      record
    });
    const second = await exportProductPriceCsv({
      outputDirectory: temporaryDirectory,
      fileName: "price.csv",
      record
    });

    expect(first.fileName).toBe("price.csv");
    expect(second.fileName).toBe("price-1.csv");
    const content = await readFile(first.savedPath, "utf8");
    expect(content.startsWith("\uFEFF")).toBe(true);
    expect(content).toContain('"Demo ""Product"""');
    expect(content).toContain("12.99");
  });

  it("rejects a relative output directory", async () => {
    await expect(
      exportProductPriceCsv({
        outputDirectory: "exports",
        record: {
          productTitle: "Demo",
          priceText: "$1.00",
          priceValue: 1,
          currency: "USD",
          sourceUrl: "https://www.amazon.com/dp/test",
          capturedAt: "2026-07-24T00:00:00.000Z"
        }
      })
    ).rejects.toThrow("绝对路径");
  });
});
