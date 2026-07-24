import { open, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ManagedBrowserManager } from "./managed-browser-manager";

export const AMAZON_TITLE_SELECTORS = [
  "#productTitle",
  "#title span",
  "h1.a-size-large",
  "h1"
] as const;

export const AMAZON_PRICE_SELECTORS = [
  "#corePrice_feature_div .a-price .a-offscreen",
  ".priceToPay .a-offscreen",
  "#apex_desktop .a-price .a-offscreen",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  ".a-price .a-offscreen"
] as const;

export type ProductPriceRecord = {
  productTitle: string;
  priceText: string;
  priceValue: number | null;
  currency: string | null;
  sourceUrl: string;
  capturedAt: string;
};

type BrowserExtractor = Pick<ManagedBrowserManager, "extract">;

export async function extractProductPrice(
  browser: BrowserExtractor,
  input: {
    localProjectId: string;
    pageId?: string;
    sourceUrl: string;
    titleSelectors?: string[];
    priceSelectors?: string[];
  }
): Promise<ProductPriceRecord> {
  const titleSelectors = normalizeSelectors(
    input.titleSelectors,
    AMAZON_TITLE_SELECTORS
  );
  const priceSelectors = normalizeSelectors(
    input.priceSelectors,
    AMAZON_PRICE_SELECTORS
  );
  const [productTitle, priceText] = await Promise.all([
    extractFirst(browser, input.localProjectId, input.pageId, titleSelectors),
    extractFirst(browser, input.localProjectId, input.pageId, priceSelectors)
  ]);
  if (!productTitle) {
    throw new Error(
      "未识别到商品名称。请确认商品页面已加载，或在节点配置中调整 titleSelectors。"
    );
  }
  if (!priceText) {
    throw new Error(
      "未识别到商品价格。页面可能需要登录或验证码，请在内置浏览器完成后重试。"
    );
  }
  const price = parsePrice(priceText, input.sourceUrl);
  return {
    productTitle,
    priceText,
    priceValue: price.value,
    currency: price.currency,
    sourceUrl: input.sourceUrl,
    capturedAt: new Date().toISOString()
  };
}

export async function exportProductPriceCsv(input: {
  outputDirectory: string;
  fileName?: string;
  record: ProductPriceRecord;
}): Promise<{
  fileName: string;
  savedPath: string;
  rowCount: 1;
}> {
  if (!isAbsolute(input.outputDirectory)) {
    throw new Error("输出目录必须是通过系统目录选择器选择的绝对路径。");
  }
  const directory = await stat(input.outputDirectory).catch(() => null);
  if (!directory?.isDirectory()) {
    throw new Error("输出目录不存在或不可访问，请重新选择目录。");
  }
  const requestedName = sanitizeCsvFileName(input.fileName);
  const allocation = await allocateCsvPath(input.outputDirectory, requestedName);
  const csv = [
    ["商品名称", "价格文本", "价格数值", "币种", "商品链接", "采集时间"],
    [
      input.record.productTitle,
      input.record.priceText,
      input.record.priceValue ?? "",
      input.record.currency ?? "",
      input.record.sourceUrl,
      input.record.capturedAt
    ]
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  try {
    await allocation.handle.writeFile(`\uFEFF${csv}\r\n`, "utf8");
  } finally {
    await allocation.handle.close();
  }
  return {
    fileName: allocation.fileName,
    savedPath: allocation.path,
    rowCount: 1
  };
}

async function extractFirst(
  browser: BrowserExtractor,
  localProjectId: string,
  pageId: string | undefined,
  selectors: string[]
): Promise<string> {
  for (const selector of selectors) {
    try {
      const text = normalizeText(
        await browser.extract(localProjectId, selector, pageId, {
          source: "workflow"
        })
      );
      if (text) return text;
    } catch {
      // Try the next selector because Amazon layouts vary by locale and experiment.
    }
  }
  return "";
}

function normalizeSelectors(
  selectors: string[] | undefined,
  defaults: readonly string[]
): string[] {
  const values = selectors?.length ? selectors : [...defaults];
  if (
    values.length > 16 ||
    values.some(
      (selector) =>
        typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 2_048
    )
  ) {
    throw new Error("商品识别选择器必须是 1 至 16 个有效 CSS selector。");
  }
  return values.map((selector) => selector.trim());
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parsePrice(
  priceText: string,
  sourceUrl: string
): { value: number | null; currency: string | null } {
  const currency = inferCurrency(priceText, sourceUrl);
  const match = priceText.match(/\d[\d.,\s]*/);
  if (!match) return { value: null, currency };
  let numeric = match[0].replace(/\s/g, "");
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  if (
    lastComma >= 0 &&
    lastDot < 0 &&
    numeric.length - lastComma - 1 === 3
  ) {
    numeric = numeric.replace(/,/g, "");
  } else if (lastComma > lastDot) {
    numeric = numeric.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = numeric.replace(/,/g, "");
  }
  const value = Number(numeric);
  return { value: Number.isFinite(value) ? value : null, currency };
}

function inferCurrency(priceText: string, sourceUrl: string): string | null {
  const normalized = priceText.toUpperCase();
  if (normalized.includes("USD") || priceText.includes("$")) return "USD";
  if (normalized.includes("GBP") || priceText.includes("£")) return "GBP";
  if (normalized.includes("EUR") || priceText.includes("€")) return "EUR";
  if (normalized.includes("CAD")) return "CAD";
  if (normalized.includes("AUD")) return "AUD";
  if (normalized.includes("INR") || priceText.includes("₹")) return "INR";
  if (normalized.includes("JPY")) return "JPY";
  if (normalized.includes("CNY") || priceText.includes("￥")) return "CNY";
  if (priceText.includes("¥")) {
    return sourceUrl.includes("amazon.co.jp") ? "JPY" : "CNY";
  }
  return null;
}

function sanitizeCsvFileName(value?: string): string {
  const fallback = `amazon-price-${new Date().toISOString().slice(0, 10)}.csv`;
  const base = (value?.trim() || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  const name = base || fallback;
  return name.toLocaleLowerCase().endsWith(".csv") ? name : `${name}.csv`;
}

async function allocateCsvPath(
  directory: string,
  requestedName: string
): Promise<{
  fileName: string;
  path: string;
  handle: Awaited<ReturnType<typeof open>>;
}> {
  const extensionIndex = requestedName.toLocaleLowerCase().lastIndexOf(".csv");
  const stem = requestedName.slice(0, extensionIndex);
  for (let index = 0; index < 1_000; index += 1) {
    const fileName = index ? `${stem}-${index}.csv` : requestedName;
    const path = join(directory, fileName);
    try {
      return { fileName, path, handle: await open(path, "wx") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("无法为导出表格分配可用文件名。");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
