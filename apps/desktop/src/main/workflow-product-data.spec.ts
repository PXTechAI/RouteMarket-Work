import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportProductPriceCsv,
  extractProductPrice
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

  it("requests user action when the page does not expose a price", async () => {
    const extract = vi.fn(async () => {
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
    ).rejects.toMatchObject({
      code: "WORKFLOW_USER_ACTION_REQUIRED",
      message: expect.stringContaining("登录或验证")
    });
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
