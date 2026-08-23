import { trMain } from "./i18n";
import { open, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ManagedBrowserManager } from "./managed-browser-manager";

export const AMAZON_TITLE_SELECTORS = ["#productTitle", "#title span", "h1.a-size-large", "h1"] as const;

export const AMAZON_PRICE_SELECTORS = [
  "#corePrice_feature_div .a-price .a-offscreen",
  ".priceToPay .a-offscreen",
  "#apex_desktop .a-price .a-offscreen",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  "#price_inside_buybox",
  "#newBuyBoxPrice",
  "#inline-twister-expanded-dimension-text-price",
  "#tp-inline-twister-dim-values-container .a-button-selected .a-price .a-offscreen",
  "#tp-inline-twister-dim-values-container .a-button-selected .a-color-price",
  "#twister_feature_div [aria-checked='true'] .a-price .a-offscreen",
  "#twister_feature_div [aria-checked='true'] .a-color-price",
  "#twister_feature_div .a-button-selected .a-price .a-offscreen",
  "#twister_feature_div .a-button-selected .a-color-price",
  ".a-price .a-offscreen",
] as const;

export type ProductPriceRecord = {
  productTitle: string;
  priceText: string;
  priceValue: number | null;
  currency: string | null;
  sourceUrl: string;
  capturedAt: string;
};

type BrowserExtractor = Pick<ManagedBrowserManager, "extract" | "getPageState" | "inspect" | "setUserTakeover">;

export async function extractProductPrice(
  browser: BrowserExtractor,
  input: {
    localProjectId: string;
    pageId?: string;
    sourceUrl: string;
    titleSelectors?: string[];
    priceSelectors?: string[];
  },
): Promise<ProductPriceRecord> {
  const state =
    typeof browser.getPageState === "function"
      ? await browser.getPageState(input.localProjectId, input.pageId)
      : { userTakeover: false };
  if (state.userTakeover) {
    throw Object.assign(new Error("请先在内置浏览器完成验证，交还 AI 控制后再继续工作流。"), {
      code: "WORKFLOW_USER_ACTION_REQUIRED",
    });
  }
  const currentUrl = "url" in state && typeof state.url === "string" ? state.url : "";
  const titleSelectors = normalizeSelectors(input.titleSelectors, AMAZON_TITLE_SELECTORS);
  const priceSelectors = normalizeSelectors(input.priceSelectors, AMAZON_PRICE_SELECTORS);
  let [productTitle, priceText] = await Promise.all([
    extractFirst(browser, input.localProjectId, input.pageId, titleSelectors),
    extractFirst(browser, input.localProjectId, input.pageId, priceSelectors),
  ]);
  let inspection: Awaited<ReturnType<NonNullable<BrowserExtractor["inspect"]>>> | null = null;
  if (!productTitle || !priceText) {
    inspection =
      typeof browser.inspect === "function"
        ? await browser.inspect(input.localProjectId, input.pageId, 250).catch(() => null)
        : null;
    if (!priceText && inspection) {
      priceText = extractVisibleProductPrice(inspection.text, input.sourceUrl);
    }
    const needsHuman = Boolean(
      inspection &&
      (/captcha|validatecaptcha|robot check|enter the characters|continue shopping|验证|验证码|不是机器人|人工验证/i.test(
        `${currentUrl}\n${inspection.title}\n${inspection.text}`,
      ) ||
        inspection.elements.some(
          (element) =>
            element.inputType?.toLowerCase() === "password" ||
            /captcha|continue shopping|验证码/i.test(`${element.name} ${element.text}`),
        )),
    );
    if (needsHuman) {
      if (typeof browser.setUserTakeover === "function") {
        await browser.setUserTakeover(input.localProjectId, true, input.pageId, { source: "workflow" });
      }
      throw Object.assign(
        new Error("Amazon 要求验证码或人工验证。请接管内置浏览器完成验证，然后交还 AI 控制并继续工作流。"),
        { code: "WORKFLOW_USER_ACTION_REQUIRED" },
      );
    }
  }
  if (!productTitle) {
    throw Object.assign(new Error(trMain("workflow.product.titleUnavailable")), {
      code: "WORKFLOW_PRODUCT_DATA_UNAVAILABLE",
    });
  }
  if (!priceText) {
    throw Object.assign(new Error(trMain("workflow.product.priceUnavailable")), {
      code: "WORKFLOW_PRODUCT_DATA_UNAVAILABLE",
    });
  }
  const price = parsePrice(priceText, input.sourceUrl);
  return {
    productTitle,
    priceText,
    priceValue: price.value,
    currency: price.currency,
    sourceUrl: input.sourceUrl,
    capturedAt: new Date().toISOString(),
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
    throw new Error(trMain("ui.4d1a280bca0b"));
  }
  const directory = await stat(input.outputDirectory).catch(() => null);
  if (!directory?.isDirectory()) {
    throw new Error(trMain("ui.f366227dbf58"));
  }
  const requestedName = sanitizeCsvFileName(input.fileName);
  const allocation = await allocateCsvPath(input.outputDirectory, requestedName);
  const csv = [
    [
      trMain("ui.47b74133f281"),
      trMain("ui.c0c20e92fda4"),
      trMain("ui.eab42da09cbe"),
      trMain("ui.a81ab5e10006"),
      trMain("ui.0bf014430dbe"),
      trMain("ui.f9fb10d4a84e"),
    ],
    [
      input.record.productTitle,
      input.record.priceText,
      input.record.priceValue ?? "",
      input.record.currency ?? "",
      input.record.sourceUrl,
      input.record.capturedAt,
    ],
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
    rowCount: 1,
  };
}

async function extractFirst(
  browser: BrowserExtractor,
  localProjectId: string,
  pageId: string | undefined,
  selectors: string[],
): Promise<string> {
  for (const selector of selectors) {
    try {
      const text = normalizeText(
        await browser.extract(localProjectId, selector, pageId, {
          source: "workflow",
        }),
      );
      if (text) return text;
    } catch {
      // Try the next selector because Amazon layouts vary by locale and experiment.
    }
  }
  return "";
}

function normalizeSelectors(selectors: string[] | undefined, defaults: readonly string[]): string[] {
  const values = selectors?.length ? selectors : [...defaults];
  if (
    values.length > 16 ||
    values.some((selector) => typeof selector !== "string" || !selector.trim() || selector.length > 2_048)
  ) {
    throw new Error(trMain("ui.d6a8c711d2a2"));
  }
  return values.map((selector) => selector.trim());
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractVisibleProductPrice(pageText: string, sourceUrl: string): string {
  const lines = pageText
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
  const candidates: Array<{ text: string; score: number; index: number }> = [];
  const pattern = /(?:\b(?:CNY|USD|CAD|AUD|GBP|EUR|JPY|INR)\s*|US\$\s*|CA\$\s*|AU\$\s*|CN[¥￥]\s*|[$£€₹¥￥]\s*)\d[\d.,\s]*/giu;
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(pattern)) {
      const text = normalizeText(match[0]).replace(/[.,\s]+$/, "");
      const parsed = parsePrice(text, sourceUrl);
      if (parsed.value === null || parsed.value <= 0) continue;
      let score = 0;
      if (/起始价|当前价|价格|price|deal|offer|售价|到手价/i.test(line)) score += 20;
      if (/已选|selected|当前选择/i.test(line)) score += 12;
      if (/CNY|CN[¥￥]|￥/i.test(text) && !sourceUrl.includes("amazon.co.jp")) score += 4;
      if (/划线价|list price|was price|原价/i.test(line)) score -= 8;
      candidates.push({ text, score, index });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0]?.text ?? "";
}

function parsePrice(priceText: string, sourceUrl: string): { value: number | null; currency: string | null } {
  const currency = inferCurrency(priceText, sourceUrl);
  const match = priceText.match(/\d[\d.,\s]*/);
  if (!match) return { value: null, currency };
  let numeric = match[0].replace(/\s/g, "");
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  if (lastComma >= 0 && lastDot < 0 && numeric.length - lastComma - 1 === 3) {
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
  requestedName: string,
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
  throw new Error(trMain("ui.2dbb4d9732e8"));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
